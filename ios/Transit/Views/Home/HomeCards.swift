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

/// One stop on Home (a favourite or a nearby stop): a leading tile, the
/// name and a detail line, then its next two departures - full width, so
/// long names and several route badges fit instead of truncating.
struct HomeStopRow<Tile: View>: View {
    let stopQuery: String
    let title: String
    var detail: String?
    @ViewBuilder var tile: Tile

    @Environment(AppEnvironment.self) private var environment
    @State private var loader = NextDeparturesLoader()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            tile
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title)
                        .font(.bodyMedium)
                        .foregroundStyle(Theme.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    if let detail {
                        Text(detail)
                            .font(.geistMono(12, relativeTo: .caption))
                            .foregroundStyle(Theme.mutedForeground)
                            .fixedSize()
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.mutedForeground.opacity(0.6))
                        .accessibilityHidden(true)
                }
                departuresContent
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
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
                Text("Loading departures").font(.meta).foregroundStyle(Theme.mutedForeground)
            }
        }
    }
}

/// The favourite's tile: its colour with a star.
struct FavouriteTile: View {
    let colorHex: String

    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color(hex: colorHex).opacity(0.18))
            .overlay(
                Image(systemName: "star.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(hex: colorHex))
            )
    }
}

/// A nearby stop's tile: its mode icon on a muted square.
struct StopModeTile: View {
    let stopType: String

    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Theme.muted)
            .overlay(
                Image(systemName: stopType == "train" ? "tram.fill" : stopType == "ferry" ? "ferry.fill" : "bus.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.foreground)
            )
    }
}

/// Rename / colour / reorder / remove favourites - a native List, so
/// drag-to-reorder and swipe-to-delete work as expected.
struct ManageFavouritesSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \FavouriteStop.sortOrder) private var favourites: [FavouriteStop]
    @State private var renaming: FavouriteStop?
    @State private var draftName = ""

    var body: some View {
        NavigationStack {
            List {
                ForEach(favourites) { favourite in
                    HStack(spacing: 12) {
                        FavouriteTile(colorHex: favourite.colorHex).frame(width: 32, height: 32)
                        Text(favourite.displayName).font(.bodyMedium).lineLimit(2)
                        Spacer()
                        Menu {
                            Button {
                                draftName = favourite.displayName
                                renaming = favourite
                            } label: { Label("Rename", systemImage: "pencil") }
                            SwatchMenu(selectedHex: favourite.colorHex) { favourite.colorHex = $0 }
                        } label: {
                            Image(systemName: "ellipsis.circle").font(.system(size: 18))
                        }
                        .accessibilityLabel("Options for \(favourite.displayName)")
                    }
                    .listRowBackground(Theme.card)
                }
                .onMove(perform: move)
                .onDelete(perform: delete)
            }
            .scrollContentBackground(.hidden)
            .groupedPageBackground()
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Favourites")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { DoneButton() }
            .overlay {
                if favourites.isEmpty {
                    EmptyState(systemImage: "star", title: "No favourites", message: "Tap the star on any stop to pin it to Home.")
                }
            }
            .alert("Rename favourite", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Display name", text: $draftName)
                Button("Save") {
                    let trimmed = draftName.trimmingCharacters(in: .whitespaces)
                    if !trimmed.isEmpty { renaming?.displayName = trimmed }
                    renaming = nil
                }
                Button("Cancel", role: .cancel) { renaming = nil }
            }
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        var ordered = favourites
        ordered.move(fromOffsets: source, toOffset: destination)
        for (i, favourite) in ordered.enumerated() { favourite.sortOrder = i }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets { modelContext.delete(favourites[index]) }
    }
}
