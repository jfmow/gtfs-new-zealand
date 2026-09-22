import SwiftData
import SwiftUI
import TransitCore

/// A stop's departures board - `components/services/index.tsx`. Polls every
/// 10s while the app is active; switches to a one-shot schedule fetch when a
/// date is picked, same as the web board.
struct StopBoardView: View {
    let stopQuery: String
    let title: String

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @Query private var favourites: [FavouriteStop]

    @State private var departures: [Departure] = []
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var isNotFound = false
    @State private var selectedDate: Date?
    @State private var platformFilter: String?
    @State private var pollTask: Task<Void, Never>?

    init(stopQuery: String, title: String) {
        self.stopQuery = stopQuery
        self.title = title
        let query = stopQuery
        _favourites = Query(filter: #Predicate<FavouriteStop> { $0.stopID == query })
    }

    var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        toggleFavourite()
                    } label: {
                        Image(systemName: favourites.isEmpty ? "star" : "star.fill")
                    }
                }
            }
            .task { await start() }
            .onDisappear { pollTask?.cancel() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refresh() } } else { pollTask?.cancel() }
            }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading, departures.isEmpty {
            ProgressView()
        } else if isNotFound {
            ContentUnavailableView("No services scheduled", systemImage: "calendar.badge.exclamationmark")
        } else if let errorMessage, departures.isEmpty {
            ContentUnavailableView("Couldn't load departures", systemImage: "wifi.slash", description: Text(errorMessage))
        } else {
            List {
                if !platformOptions.isEmpty {
                    platformFilterSection
                }
                ForEach(visibleDepartures) { departure in
                    if departure.isTrackable {
                        NavigationLink(value: departure.tripID) {
                            DepartureRow(departure: departure)
                        }
                    } else {
                        DepartureRow(departure: departure)
                    }
                }
            }
            .navigationDestination(for: String.self) { tripID in
                VehicleQuickLookView(tripID: tripID)
            }
        }
    }

    private var platformFilterSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    FilterChip(title: "All", isSelected: platformFilter == nil) { platformFilter = nil }
                    ForEach(platformOptions, id: \.self) { platform in
                        FilterChip(title: "Platform \(platform)", isSelected: platformFilter == platform) {
                            platformFilter = platform
                        }
                    }
                }
            }
            .listRowInsets(EdgeInsets())
            .padding(.horizontal)
            .padding(.vertical, 4)
        }
    }

    private var platformOptions: [String] {
        Array(Set(departures.compactMap { $0.platform.isEmpty ? nil : $0.platform })).sorted()
    }

    private var visibleDepartures: [Departure] {
        let sorted = DepartureBoard.filterAndSort(departures)
        guard let platformFilter else { return sorted }
        return sorted.filter { $0.platform == platformFilter }
    }

    // MARK: - Data

    private func start() async {
        await refresh()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, selectedDate == nil else { continue }
                await refresh()
            }
        }
    }

    private func refresh() async {
        isLoading = departures.isEmpty
        defer { isLoading = false }
        do {
            if let selectedDate {
                departures = try await environment.api.schedule(stop: stopQuery, date: selectedDate)
            } else {
                departures = try await environment.api.departures(stop: stopQuery)
            }
            errorMessage = nil
            isNotFound = false
        } catch let APIError.server(code, _, _) where code == 404 {
            departures = []
            isNotFound = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func toggleFavourite() {
        if let existing = favourites.first {
            modelContext.delete(existing)
            return
        }
        let nextOrder = (try? modelContext.fetchCount(FetchDescriptor<FavouriteStop>())) ?? 0
        let favourite = FavouriteStop(stopID: stopQuery, displayName: title, colorHex: favouriteColor(for: nextOrder), sortOrder: nextOrder)
        modelContext.insert(favourite)
    }

    private func favouriteColor(for index: Int) -> String {
        let swatches = ["0073bd", "d52923", "2a286b", "97c93d", "ced940", "6ec3db", "f59e0b", "8b5cf6"]
        return swatches[index % swatches.count]
    }
}

struct DepartureRow: View {
    let departure: Departure

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: departure.route.color.isEmpty ? "6b7280" : departure.route.color))
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(departure.route.name).font(.headline)
                    Text(departure.headsign).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                statusLine
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(countdownText)
                    .font(.headline)
                    .foregroundStyle(departure.canceled ? .red : .primary)
                if !departure.platform.isEmpty {
                    Text("Platform \(departure.platform)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .opacity(departure.departed ? 0.5 : 1)
    }

    private var countdownText: String {
        if departure.canceled { return "Cancelled" }
        if departure.skipped { return "Not stopping" }
        return TimeFormatting.timeTillArrivalString(minutes: departure.timeTillArrival)
    }

    @ViewBuilder
    private var statusLine: some View {
        if departure.canceled {
            Label("Cancelled", systemImage: "xmark.circle").font(.caption).foregroundStyle(.red)
        } else if departure.platformChanged {
            Label("Platform changed", systemImage: "arrow.triangle.2.circlepath").font(.caption).foregroundStyle(.orange)
        } else if !departure.locationTracking, !departure.tripUpdateTracking {
            Text("Timetable only").font(.caption).foregroundStyle(.secondary)
        } else if !departure.locationTracking {
            Text("Limited tracking").font(.caption).foregroundStyle(.secondary)
        } else if departure.stopsAway == 0 {
            Label("At this stop", systemImage: "location.fill").font(.caption).foregroundStyle(.green)
        }
    }
}

struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.caption)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(isSelected ? Color.accentColor : Color(.secondarySystemBackground))
                .foregroundStyle(isSelected ? Color.white : Color.primary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
