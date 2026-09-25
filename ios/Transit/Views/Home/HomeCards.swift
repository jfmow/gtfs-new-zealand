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

    @Environment(\.dynamicTypeSize) private var typeSize

    private var platformText: String? {
        guard showsPlatform, !departure.platform.isEmpty, departure.platform != "no platform" else { return nil }
        return "Pl \(departure.platform)"
    }

    private var isLive: Bool {
        !departure.canceled && (departure.tripUpdateTracking || departure.locationTracking)
    }

    /// Live (realtime-tracked) countdowns are blue with a signal glyph, like
    /// the board; scheduled ones stay plain.
    private var countdown: some View {
        let text = departure.canceled ? "Cancelled" : TimeFormatting.timeTillArrivalString(minutes: departure.timeTillArrival)
        return HStack(spacing: 3) {
            if isLive {
                Image(systemName: "dot.radiowaves.up.forward")
                    .font(.system(size: 9, weight: .semibold))
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(.geistMono(12, medium: true, relativeTo: .caption))
        }
        .foregroundStyle(departure.canceled ? Theme.danger : isLive ? Theme.live : Theme.foreground)
        .lineLimit(1)
        .fixedSize()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isLive ? "Live, \(text)" : text)
    }

    var body: some View {
        if typeSize.isAccessibilitySize {
            // Too big for one line: badge + countdown, then the full
            // destination underneath instead of "Newmar...".
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    RouteBadge(name: departure.route.name, colorHex: departure.route.color, size: 11)
                    Spacer(minLength: 6)
                    countdown
                }
                Text(TimeFormatting.niceLookingWords(departure.headsign) + (platformText.map { " · \($0)" } ?? ""))
                    .font(.meta)
                    .foregroundStyle(Theme.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            oneLine
        }
    }

    private var oneLine: some View {
        HStack(spacing: 8) {
            RouteBadge(name: departure.route.name, colorHex: departure.route.color, size: 11)
            Text(TimeFormatting.niceLookingWords(departure.headsign))
                .font(.meta)
                .foregroundStyle(Theme.foreground)
                .lineLimit(1)
            Spacer(minLength: 6)
            if let platformText {
                Text(platformText).font(.meta).foregroundStyle(Theme.mutedForeground)
            }
            countdown
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
            VStack(alignment: .leading, spacing: 10) {
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
                VStack(alignment: .leading, spacing: 8) {
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
            .navigationTitle("Saved stops")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { DoneButton() }
            .overlay {
                if favourites.isEmpty {
                    EmptyState(systemImage: "star", title: "No saved stops", message: "Tap the star on any stop to pin it to Home.")
                }
            }
            .alert("Rename saved stop", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
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

// MARK: - Home layout

/// A Home section: small-caps label with an optional count and trailing
/// actions, then its content. The header is inset; the content sets its
/// own horizontal padding so carousels can run edge to edge.
struct HomeSection<Actions: View, Content: View>: View {
    let title: String
    var count = 0
    var liveDot = false
    @ViewBuilder var actions: Actions
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                SectionLabel(text: title, liveDot: liveDot)
                if count > 0 {
                    Text("\(count)")
                        .font(.geistMono(11, medium: true, relativeTo: .caption))
                        .foregroundStyle(Theme.mutedForeground)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.muted, in: Capsule())
                        .accessibilityLabel("\(count) saved")
                }
                Spacer()
                actions
                    .font(.metaMedium)
                    .foregroundStyle(Theme.mutedForeground)
            }
            .padding(.horizontal, 16)
            content
        }
    }
}

/// An empty/informational state inside a Home section - a dashed card with
/// an icon, a line of text and an optional action.
struct HomeHint<Action: View>: View {
    let systemImage: String
    let text: String
    @ViewBuilder var action: Action

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.mutedForeground)
                .frame(width: 36, height: 36)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(text)
                    .font(.meta)
                    .foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                action
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous)
                .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        )
    }
}

extension HomeHint where Action == EmptyView {
    init(systemImage: String, text: String) {
        self.init(systemImage: systemImage, text: text) { EmptyView() }
    }
}

// MARK: - Saved trips

/// Saved trips as a swipeable row of cards - tap one to plan it now in the
/// Planner tab. At accessibility text sizes they stack full width instead.
struct SavedTripsCarousel: View {
    let trips: [SavedTrip]
    let onPlan: (SavedTrip) -> Void
    let onManage: () -> Void

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if typeSize.isAccessibilitySize {
            VStack(spacing: 10) {
                ForEach(trips, id: \.persistentModelID) { trip in
                    HomeTripCard(trip: trip, onPlan: { onPlan(trip) }, onManage: onManage)
                }
            }
            .padding(.horizontal, 16)
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(trips, id: \.persistentModelID) { trip in
                        HomeTripCard(trip: trip, onPlan: { onPlan(trip) }, onManage: onManage)
                            .frame(width: trips.count == 1 ? nil : 236)
                    }
                }
                .scrollTargetLayout()
                // Room for the card shadow, which a horizontal ScrollView
                // would otherwise clip.
                .padding(.vertical, 2)
            }
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollDisabled(trips.count == 1)
        }
    }
}

/// One saved trip: colour tile + name, the from/to pair, and a "Plan now"
/// cue. Long-press to rename, recolour or delete.
struct HomeTripCard: View {
    @Bindable var trip: SavedTrip
    let onPlan: () -> Void
    let onManage: () -> Void

    @Environment(\.modelContext) private var modelContext
    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var isRenaming = false
    @State private var draftName = ""

    var body: some View {
        Button(action: onPlan) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color(hex: trip.colorHex).opacity(0.18))
                        .overlay(
                            Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color(hex: trip.colorHex))
                        )
                        .frame(width: 30, height: 30)
                        .accessibilityHidden(true)
                    Text(trip.name)
                        .font(.bodyMedium)
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                    Spacer(minLength: 0)
                }

                VStack(alignment: .leading, spacing: 6) {
                    endpoint(trip.startLabel, filled: false)
                    endpoint(trip.endLabel, filled: true)
                }

                HStack(spacing: 4) {
                    Text("Plan now")
                    Image(systemName: "arrow.right").font(.system(size: 11, weight: .semibold))
                }
                .font(.metaMedium)
                .foregroundStyle(Theme.foreground)
                .accessibilityHidden(true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .shadCardBackground()
            .contentShape(RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                draftName = trip.name
                isRenaming = true
            } label: { Label("Rename", systemImage: "pencil") }
            SwatchMenu(selectedHex: trip.colorHex) { trip.colorHex = $0 }
            Button(action: onManage) { Label("Manage trips", systemImage: "slider.horizontal.3") }
            Divider()
            Button(role: .destructive) {
                modelContext.delete(trip)
                environment.toasts.show("Trip deleted")
            } label: { Label("Delete", systemImage: "trash") }
        }
        .alert("Rename trip", isPresented: $isRenaming) {
            TextField("Trip name", text: $draftName)
            Button("Save") {
                let trimmed = draftName.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty { trip.name = trimmed }
            }
            Button("Cancel", role: .cancel) {}
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(trip.name), from \(trip.startLabel) to \(trip.endLabel)")
        .accessibilityHint("Plans this trip now. Touch and hold for options.")
    }

    private func endpoint(_ label: String, filled: Bool) -> some View {
        HStack(spacing: 8) {
            Circle()
                .strokeBorder(Theme.mutedForeground, lineWidth: filled ? 0 : 1.5)
                .background(Circle().fill(filled ? Color(hex: trip.colorHex) : .clear))
                .frame(width: 8, height: 8)
            Text(label)
                .font(.meta)
                .foregroundStyle(filled ? Theme.foreground : Theme.mutedForeground)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
        }
    }
}
