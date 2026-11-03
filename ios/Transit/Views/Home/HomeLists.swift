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

// MARK: - Greeting

/// "Good afternoon", then the date and region.
struct HomeGreeting: View {
    let region: String

    var body: some View {
        TimelineView(.everyMinute) { context in
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.greeting(for: context.date))
                    .font(.geist(24, .semibold, relativeTo: .title2))
                    .foregroundStyle(Theme.foreground)
                    .accessibilityAddTraits(.isHeader)
                Text("\(context.date.formatted(.dateTime.weekday(.wide).day().month(.wide))) · \(region)")
                    .font(.meta)
                    .foregroundStyle(Theme.mutedForeground)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
        }
    }

    static func greeting(for date: Date) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<12: "Good morning"
        case 12..<17: "Good afternoon"
        case 17..<22: "Good evening"
        default: "Late one?"
        }
    }
}

extension Departure {
    var isLiveForHome: Bool { !canceled && (tripUpdateTracking || locationTracking) }

    var homeCountdown: String {
        if canceled { return "Cancelled" }
        if timeTillArrival >= 60, let clock = TimeFormatting.convert24hTo12h(arrivalTime) { return clock }
        return TimeFormatting.timeTillArrivalString(minutes: timeTillArrival)
    }

}

// MARK: - Shortcuts

/// Places and saved trips together - everything here plans a journey in one
/// tap. Round icon buttons with a label underneath, like a dock.
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
            HStack(alignment: .top, spacing: 10) {
                if let onFindVehicle {
                    item("Find vehicle", action: onFindVehicle) {
                        Circle().fill(Theme.primary)
                            .overlay(glyph("location.viewfinder", color: Theme.primaryForeground))
                    }
                    .accessibilityLabel("Find my vehicle")
                    .accessibilityHint("Finds the bus, train or ferry you're on from your location.")
                }
                ForEach(places, id: \.persistentModelID) { place in
                    item(place.name, action: { onGo(place) }) {
                        tinted(place.placeIcon.colorHex, symbol: place.placeIcon.systemImage)
                    }
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
                    item(trip.name, action: { onPlanTrip(trip) }) {
                        tinted(trip.colorHex, symbol: "point.topleft.down.to.point.bottomright.curvepath", size: 18)
                    }
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
                    if !places.contains(where: { $0.placeIcon == .home }) { addItem("Home", icon: .home) }
                    if !places.contains(where: { $0.placeIcon == .work }) { addItem("Work", icon: .work) }
                }
                addItem(nil, icon: .pin)
            }
        }
        .contentMargins(.horizontal, 12, for: .scrollContent)
    }

    private func addItem(_ name: String?, icon: SavedPlaceIcon) -> some View {
        item(name.map { "Add \($0.lowercased())" } ?? "Add", action: { onAddPlace(name ?? "", icon) }) {
            Circle().strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                .overlay(glyph(name == nil ? "plus" : icon.systemImage, color: Theme.mutedForeground, size: 18))
        }
        .accessibilityLabel(name.map { "Add \($0.lowercased())" } ?? "Add place")
    }

    private func tinted(_ hex: String, symbol: String, size: CGFloat = 20) -> some View {
        Circle().fill(Color(hex: hex).opacity(0.16))
            .overlay(glyph(symbol, color: Color(hex: hex), size: size))
    }

    private func glyph(_ name: String, color: Color, size: CGFloat = 20) -> some View {
        Image(systemName: name).font(.system(size: size, weight: .semibold)).foregroundStyle(color)
    }

    private func item(_ label: String, action: @escaping () -> Void, @ViewBuilder icon: () -> some View) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                icon().frame(width: 56, height: 56)
                Text(label)
                    .font(.geist(12, .medium, relativeTo: .caption))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(1)
            }
            .frame(width: 70)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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

/// Board cards stacked, or on iPad (`columns` > 1) in a grid so both
/// sides fill evenly.
struct HomeBoardStack<Item: Identifiable, Card: View>: View {
    let items: [Item]
    var columns = 1
    @ViewBuilder var card: (Item) -> Card

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: columns), spacing: 10) {
            ForEach(items) { item in card(item) }
        }
        .padding(.horizontal, 16)
    }
}

/// A stop as a tiny departure board: a header, then a line per departure
/// with its headsign and a right-aligned countdown.
struct HomeBoardCard<Tile: View>: View {
    let stopQuery: String
    let title: String
    var detail: String?
    var lines = 3
    @ViewBuilder var tile: Tile

    @Environment(AppEnvironment.self) private var environment
    @State private var loader = NextDeparturesLoader()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                tile.frame(width: 24, height: 24).accessibilityHidden(true)
                Text(title).font(.cardTitle).foregroundStyle(Theme.foreground).lineLimit(1)
                Spacer(minLength: 6)
                if let detail {
                    Text(detail).font(.meta).foregroundStyle(Theme.mutedForeground).fixedSize()
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground.opacity(0.7))
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 8)

            if let list = loader.departures {
                if list.isEmpty {
                    note("No more departures today")
                } else {
                    ForEach(list) { departure in
                        Rectangle().fill(Theme.border).frame(height: 1).padding(.leading, 14)
                        line(departure)
                    }
                }
            } else if loader.failed {
                note("Couldn't load departures")
            } else {
                ForEach(0..<lines, id: \.self) { _ in
                    Rectangle().fill(Theme.border).frame(height: 1).padding(.leading, 14)
                    HStack { Text("NX1 Somewhere far away"); Spacer(); Text("10 min") }
                        .font(.bodyText).padding(.horizontal, 14).padding(.vertical, 9)
                        .redacted(reason: .placeholder)
                }
            }
        }
        .padding(.bottom, 3)
        .opacity(loader.isStale ? 0.6 : 1)
        .shadCardBackground(radius: 16)
        .contentShape(Rectangle())
        .foregroundPoll(every: .seconds(30), id: stopQuery) {
            await loader.load(stop: stopQuery, limit: lines, api: environment.api)
        }
    }

    private func line(_ departure: Departure) -> some View {
        HStack(spacing: 10) {
            RouteBadge(name: departure.route.name, colorHex: departure.route.color, size: 11)
                .frame(minWidth: 40, alignment: .leading)
            Text(departure.headsign)
                .font(.bodyText)
                .foregroundStyle(departure.canceled ? Theme.mutedForeground : Theme.foreground)
                .strikethrough(departure.canceled)
                .lineLimit(1)
            Spacer(minLength: 8)
            if departure.isLiveForHome {
                Image(systemName: "dot.radiowaves.up.forward")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.live)
                    .accessibilityHidden(true)
            }
            HomeMinutes(departure: departure, size: 15)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.meta).foregroundStyle(Theme.mutedForeground)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 10)
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
