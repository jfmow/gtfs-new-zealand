import SwiftData
import SwiftUI
import TransitCore

/// `lib/colors.ts` SWATCH_COLORS - the palette for anything the rider
/// colours themselves (favourite stops, saved trips), same on both apps.
enum Swatches {
    static let all: [(hex: String, name: String)] = [
        ("f59e0b", "Amber"), ("f43f5e", "Rose"), ("0ea5e9", "Sky"), ("10b981", "Emerald"),
        ("8b5cf6", "Violet"), ("f97316", "Orange"), ("06b6d4", "Cyan"), ("d946ef", "Fuchsia"),
    ]

    static func color(at index: Int) -> String { all[index % all.count].hex }
}

/// Next departures for one stop, soonest first - `useNextDepartures` in
/// `components/home/stop-preview-card.tsx`.
@MainActor
@Observable
final class NextDeparturesLoader {
    private(set) var departures: [Departure]?
    private(set) var failed = false

    func load(stop: String, limit: Int, api: APIClient) async {
        do {
            let all = try await api.departures(stop: stop, limit: 8)
            departures = Array(all.filter { $0.timeTillArrival >= 0 && !$0.departed }
                .sorted { $0.timeTillArrival < $1.timeTillArrival }
                .prefix(limit))
            failed = false
        } catch let error as APIError {
            if case .server(let code, _, _) = error, code == 404 {
                departures = []
            } else if departures == nil {
                failed = true
            }
        } catch {
            if departures == nil { failed = true }
        }
    }
}

/// One departure line inside a preview/favourite card: route badge,
/// headsign, platform, countdown.
struct DepartureLine: View {
    let departure: Departure
    var showsPlatform = true

    var body: some View {
        HStack(spacing: 8) {
            RouteBadge(name: departure.route.name, colorHex: departure.route.color, size: 11)
            Text(TimeFormatting.niceLookingWords(departure.headsign))
                .font(.meta)
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
            Spacer(minLength: 6)
            if showsPlatform, !departure.platform.isEmpty, departure.platform != "no platform" {
                Text("Pl \(departure.platform)").font(.meta).foregroundStyle(Theme.mutedForeground)
            }
            Text(departure.canceled ? "Cancelled" : TimeFormatting.timeTillArrivalString(minutes: departure.timeTillArrival))
                .font(.geistMono(12, relativeTo: .caption))
                .foregroundStyle(departure.canceled ? Theme.danger : Theme.mutedForeground)
                .lineLimit(1)
                .fixedSize()
        }
    }
}

/// `StopPreviewCard` - the nearest stop on Home: name (+ code when needed),
/// distance, and its next two departures.
struct StopPreviewCard: View {
    let stopQuery: String
    let label: String
    var code: String?
    var meta: String?

    @Environment(AppEnvironment.self) private var environment
    @State private var loader = NextDeparturesLoader()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                (Text(label).font(.bodyMedium)
                    + Text(code.map { " · Stop \($0)" } ?? "").font(.bodyText).foregroundColor(Theme.mutedForeground))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let meta {
                    Text(meta).font(.geistMono(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground)
                }
            }
            departuresContent
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadCardBackground(radius: Theme.radiusMD)
        .task(id: stopQuery) {
            while !Task.isCancelled {
                await loader.load(stop: stopQuery, limit: 2, api: environment.api)
                try? await Task.sleep(for: .seconds(30))
            }
        }
    }

    @ViewBuilder
    private var departuresContent: some View {
        if let departures = loader.departures {
            if departures.isEmpty {
                Text("No upcoming services").font(.meta).foregroundStyle(Theme.mutedForeground)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(departures) { DepartureLine(departure: $0) }
                }
            }
        } else if loader.failed {
            Text("Couldn't load departures").font(.meta).foregroundStyle(Theme.mutedForeground)
        } else {
            HStack(spacing: 6) {
                ProgressView().controlSize(.mini)
                Text("Loading departures...").font(.meta).foregroundStyle(Theme.mutedForeground)
            }
        }
    }
}

/// A favourite stop in the Home rail - `FavoriteCard` in
/// `components/stops/favourites.tsx`: coloured left edge, star + name, the
/// next departure. Long-press for rename / colour / move / remove.
struct FavouriteCard: View {
    @Bindable var favourite: FavouriteStop
    let canMoveLeft: Bool
    let canMoveRight: Bool
    let onMove: (Int) -> Void
    let onRemove: () -> Void

    @Environment(AppEnvironment.self) private var environment
    @State private var loader = NextDeparturesLoader()
    @State private var isRenaming = false
    @State private var draftName = ""

    var body: some View {
        let accent = Color(hex: favourite.colorHex)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(accent)
                Text(favourite.displayName).font(.bodyMedium).lineLimit(1)
            }
            Group {
                if let next = loader.departures?.first {
                    DepartureLine(departure: next, showsPlatform: false)
                } else if loader.departures != nil {
                    Text("No upcoming services").font(.meta).foregroundStyle(Theme.mutedForeground)
                } else if loader.failed {
                    Text("Couldn't load departures").font(.meta).foregroundStyle(Theme.mutedForeground)
                } else {
                    ProgressView().controlSize(.mini)
                }
            }
            .frame(height: 18, alignment: .leading)
        }
        .padding(12)
        .frame(width: 200, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: Theme.radiusLG, bottomLeadingRadius: Theme.radiusLG, style: .continuous)
                .fill(accent)
                .frame(width: 3)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
        .contextMenu {
            Button {
                draftName = favourite.displayName
                isRenaming = true
            } label: { Label("Rename", systemImage: "pencil") }
            SwatchMenu(selectedHex: favourite.colorHex) { favourite.colorHex = $0 }
            if canMoveLeft { Button { onMove(-1) } label: { Label("Move left", systemImage: "arrow.left") } }
            if canMoveRight { Button { onMove(1) } label: { Label("Move right", systemImage: "arrow.right") } }
            Divider()
            Button(role: .destructive, action: onRemove) { Label("Remove from favourites", systemImage: "trash") }
        }
        .alert("Rename favourite", isPresented: $isRenaming) {
            TextField("Display name", text: $draftName)
            Button("Save") {
                let trimmed = draftName.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty { favourite.displayName = trimmed }
            }
            Button("Cancel", role: .cancel) {}
        }
        .task(id: favourite.stopID) {
            while !Task.isCancelled {
                await loader.load(stop: favourite.stopID, limit: 1, api: environment.api)
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens departures. Touch and hold for options.")
    }
}
