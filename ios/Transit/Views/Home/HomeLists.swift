import SwiftData
import SwiftUI
import TransitCore

// Home's pieces: the shortcut chip row and the grouped stop lists.

/// A departure's countdown in mono - live ones blue, cancelled red.
struct HomeMinutes: View {
    let departure: Departure
    var size: CGFloat = 13

    private var isLive: Bool { !departure.canceled && (departure.tripUpdateTracking || departure.locationTracking) }

    /// Countdown within the hour; past that, the clock time ("4:15pm") -
    /// "7 hr 39 min" is too long for a compact row and less useful.
    private var text: String {
        if departure.canceled { return "Cancelled" }
        if departure.timeTillArrival >= 60, let clock = TimeFormatting.convert24hTo12h(departure.arrivalTime) { return clock }
        return TimeFormatting.timeTillArrivalString(minutes: departure.timeTillArrival)
    }

    var body: some View {
        Text(text)
            .font(.geistMono(size, medium: true, relativeTo: .callout))
            .foregroundStyle(departure.canceled ? Theme.danger : isLive ? Theme.live : Theme.foreground)
            .lineLimit(1)
            .fixedSize()
            .accessibilityLabel(isLive ? "Live, \(text)" : text)
    }
}

enum StopGlyph {
    static func name(for stopType: String) -> String {
        stopType == "train" ? "tram.fill" : stopType == "ferry" ? "ferry.fill" : "bus.fill"
    }
}

// MARK: - Shortcuts

/// Places and saved trips together - everything here plans a journey in one tap.
struct HomeShortcutsRow: View {
    let places: [SavedPlace]
    let trips: [SavedTrip]
    /// Nil where the region has no live vehicle positions.
    let onFindVehicle: (() -> Void)?
    let onGo: (SavedPlace) -> Void
    let onEditPlace: (SavedPlace) -> Void
    let onManagePlaces: () -> Void
    let onAddPlace: (_ name: String, _ icon: SavedPlaceIcon) -> Void
    let onPlanTrip: (SavedTrip) -> Void
    let onManageTrips: () -> Void

    @Environment(\.modelContext) private var modelContext
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if let onFindVehicle {
                    HomeFindVehicleChip(action: onFindVehicle)
                }
                ForEach(places, id: \.persistentModelID) { place in
                    Button { onGo(place) } label: {
                        chip { SavedPlaceTile(icon: place.placeIcon, size: 24) } text: { Text(place.name) }
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { onEditPlace(place) } label: { Label("Edit", systemImage: "pencil") }
                        Button(action: onManagePlaces) { Label("Manage places", systemImage: "slider.horizontal.3") }
                        Divider()
                        Button(role: .destructive) {
                            modelContext.delete(place)
                            environment.toasts.show("Place deleted")
                        } label: { Label("Delete", systemImage: "trash") }
                    }
                    .accessibilityLabel(place.name)
                    .accessibilityIdentifier("shortcut.\(place.name)")
                    .accessibilityHint("Plans a trip to \(place.address) from your location. Touch and hold for options.")
                }

                ForEach(trips, id: \.persistentModelID) { trip in
                    Button { onPlanTrip(trip) } label: {
                        chip {
                            Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color(hex: trip.colorHex))
                                .frame(width: 24, height: 24)
                                .background(Color(hex: trip.colorHex).opacity(0.18), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        } text: { Text(trip.name) }
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button(action: onManageTrips) { Label("Manage trips", systemImage: "slider.horizontal.3") }
                        Divider()
                        Button(role: .destructive) {
                            modelContext.delete(trip)
                            environment.toasts.show("Trip deleted")
                        } label: { Label("Delete", systemImage: "trash") }
                    }
                    .accessibilityLabel("\(trip.name), from \(trip.startLabel) to \(trip.endLabel)")
                }

                if places.count < 2 {
                    if !places.contains(where: { $0.placeIcon == .home }) { addChip("Home", icon: .home) }
                    if !places.contains(where: { $0.placeIcon == .work }) { addChip("Work", icon: .work) }
                }
                addChip(nil, icon: .pin)
            }
            .padding(.vertical, 2)
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
    }

    private func addChip(_ name: String?, icon: SavedPlaceIcon) -> some View {
        Button { onAddPlace(name ?? "", icon) } label: {
            Group {
                if let name {
                    HStack(spacing: 6) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                        Text("Add \(name.lowercased())").font(.bodyMedium)
                    }
                    .padding(.horizontal, 14)
                } else {
                    Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).frame(width: 36)
                }
            }
            .foregroundStyle(Theme.mutedForeground)
            .frame(height: 36)
            .overlay(Capsule().strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name.map { "Add \($0.lowercased())" } ?? "Add place")
    }

    private func chip(@ViewBuilder icon: () -> some View, @ViewBuilder text: () -> some View) -> some View {
        HStack(spacing: 8) {
            icon()
            text().font(.bodyMedium).foregroundStyle(Theme.foreground).lineLimit(1)
        }
        .padding(.leading, 6)
        .padding(.trailing, 14)
        .frame(height: 36)
        .background(Theme.card, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.border, lineWidth: 1))
        .contentShape(Capsule())
    }
}

/// "Find my vehicle" - filled, so it stands apart from the saved shortcuts.
struct HomeFindVehicleChip: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: "location.viewfinder").font(.system(size: 14, weight: .semibold))
                Text("Find my vehicle").font(.bodyMedium).lineLimit(1)
            }
            .foregroundStyle(Theme.primaryForeground)
            .padding(.horizontal, 14)
            .frame(height: 36)
            .background(Theme.primary, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Finds the bus, train or ferry you're on from your location.")
    }
}

// MARK: - Stop lists

/// A Home heading: sentence case, with an optional trailing action.
struct HomeHeading<Action: View>: View {
    let title: String
    var liveDot = false
    @ViewBuilder var action: Action

    var body: some View {
        HStack(spacing: 8) {
            if liveDot { LiveDot(color: Theme.live) }
            Text(title).font(.cardTitle).foregroundStyle(Theme.foreground)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            action.font(.metaMedium).foregroundStyle(Theme.mutedForeground)
        }
        .padding(.horizontal, 16)
    }
}

/// One surface around a list of rows, with hairlines between them.
struct HomeGroup<Item: Identifiable, Row: View>: View {
    let items: [Item]
    @ViewBuilder var row: (Item) -> Row

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 {
                    Rectangle().fill(Theme.border).frame(height: 1).padding(.leading, 46)
                }
                row(item)
            }
        }
        .shadCardBackground(radius: 14)
        .padding(.horizontal, 16)
    }
}

/// A compact stop row: tile, name and distance, then the next departures
/// as route + minutes pairs.
struct HomeCompactStopRow<Tile: View>: View {
    let stopQuery: String
    let title: String
    var detail: String?
    @ViewBuilder var tile: Tile

    @Environment(AppEnvironment.self) private var environment
    @State private var loader = NextDeparturesLoader()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            tile
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title)
                        .font(.bodyMedium)
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    if let detail {
                        Text(detail).font(.meta).foregroundStyle(Theme.mutedForeground).fixedSize()
                    }
                }
                departures
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .foregroundPoll(every: .seconds(30), id: stopQuery) {
            await loader.load(stop: stopQuery, limit: 3, api: environment.api)
        }
    }

    @ViewBuilder
    private var departures: some View {
        if let list = loader.departures {
            if list.isEmpty {
                Text("No more departures today").font(.meta).foregroundStyle(Theme.mutedForeground)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { pairs(list) }
                    VStack(alignment: .leading, spacing: 6) { pairs(list) }
                }
                .opacity(loader.isStale ? 0.6 : 1)
            }
        } else if loader.failed {
            Text("Couldn't load departures").font(.meta).foregroundStyle(Theme.mutedForeground)
        } else {
            Text("Loading").font(.meta).foregroundStyle(Theme.mutedForeground).redacted(reason: .placeholder)
        }
    }

    private func pairs(_ list: [Departure]) -> some View {
        ForEach(list) { departure in
            HStack(spacing: 4) {
                RouteBadge(name: departure.route.name, colorHex: departure.route.color, size: 10)
                HomeMinutes(departure: departure, size: 12)
            }
        }
    }
}

/// A saved stop's small tile: its colour, a star.
struct HomeSavedTile: View {
    let colorHex: String

    var body: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(Color(hex: colorHex).opacity(0.18))
            .overlay(Image(systemName: "star.fill").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color(hex: colorHex)))
    }
}

/// A nearby stop's small tile: its mode glyph.
struct HomeModeTile: View {
    let stopType: String

    var body: some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(Theme.muted)
            .overlay(Image(systemName: StopGlyph.name(for: stopType)).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.foreground))
    }
}

// MARK: - First run

/// Shown instead of a stack of empty sections when nothing's saved yet.
struct HomeSetupCard<Actions: View>: View {
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Set up Home").font(.cardTitle)
            Text("Save the places and stops you use most and their next departures show up here.")
                .font(.meta)
                .foregroundStyle(Theme.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) { actions }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .shadCardBackground(radius: 16)
        .padding(.horizontal, 16)
    }
}
