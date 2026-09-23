import SwiftUI
import TransitCore

/// A from/to input for the planner - `components/map/search/index.tsx`.
/// The dropdown floats over the form (nothing below reflows while typing):
/// "My location" and "Pick on map" first, then either Recent (empty field)
/// or search results with their type.
///
/// Give the containing view a higher `zIndex` than whatever sits below the
/// field (the To field sits below From), so the dropdown draws on top.
///
/// Bugs fixed in earlier versions, kept here: selecting a result used to
/// re-trigger a search for the full selected label (a write to `query` fed
/// back into `.onChange`) - `suppressNextQueryChange` tells a programmatic
/// write apart from typing; and `query` follows `location` when it's set
/// from outside (a saved trip, a swap, a deeplink).
struct LocationField: View {
    let placeholder: String
    /// Keeps From and To recents separate, persisted across launches -
    /// the web's `storageKey` prop.
    let storageKey: String
    @Binding var location: PlannerLocation?

    @Environment(AppEnvironment.self) private var environment
    @State private var query = ""
    @State private var results: [LocationSearchResult] = []
    @State private var recents: [LocationSearchResult] = []
    @State private var searchTask: Task<Void, Never>?
    @State private var isLoading = false
    @State private var isLocating = false
    @State private var isPickingOnMap = false
    @State private var suppressNextQueryChange = false
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            TextField(placeholder, text: $query)
                .font(.bodyText)
                .focused($isFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .onSubmit {
                    if let first = results.first { select(first) } else { isFocused = false }
                }
                .onChange(of: query) { _, newValue in
                    if suppressNextQueryChange {
                        suppressNextQueryChange = false
                        return
                    }
                    if location?.label != newValue { location = nil }
                    scheduleSearch(newValue)
                }
            if isLocating {
                ProgressView().controlSize(.small)
            } else if !query.isEmpty {
                Button {
                    suppressNextQueryChange = true
                    query = ""
                    location = nil
                    results = []
                } label: {
                    Image(systemName: "xmark").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear \(placeholder)")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 44)
        .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous)
                .strokeBorder(isFocused ? Theme.ring.opacity(0.6) : Theme.input, lineWidth: 1)
        )
        .overlay(alignment: .topLeading) {
            if isFocused {
                dropdown.offset(y: 50)
            }
        }
        .onAppear {
            suppressNextQueryChange = !(location?.label ?? "").isEmpty
            query = location?.label ?? ""
            recents = Self.loadRecents(storageKey)
        }
        .onChange(of: location) { _, newValue in
            guard newValue?.label != query else { return }
            suppressNextQueryChange = true
            query = newValue?.label ?? ""
            results = []
        }
        .sheet(isPresented: $isPickingOnMap) {
            MapLocationPickerView(initialCoordinate: location?.coordinate) { picked in
                apply(picked)
            }
        }
    }

    private var dropdown: some View {
        VStack(alignment: .leading, spacing: 0) {
            if query.isEmpty || location != nil {
                row(icon: "location.north", label: isLocating ? "Locating..." : "My location") { useCurrentLocation() }
                row(icon: "mappin", label: "Pick on map") {
                    isFocused = false
                    isPickingOnMap = true
                }
                if !recents.isEmpty {
                    RowDivider().padding(.vertical, 4)
                    Text("RECENT")
                        .font(.geist(11, .medium, relativeTo: .caption2))
                        .tracking(0.8)
                        .foregroundStyle(Theme.mutedForeground)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 4)
                    ForEach(recents) { recent in
                        row(icon: "clock", label: recent.label) { apply(PlannerLocation(label: recent.label, coordinate: recent.coordinate)) }
                    }
                }
            } else if isLoading && results.isEmpty {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 20)
            } else if results.isEmpty {
                Text(query.count < 2 ? "Keep typing to search" : "No results found")
                    .font(.meta).foregroundStyle(Theme.mutedForeground)
                    .frame(maxWidth: .infinity).padding(.vertical, 20)
            } else {
                ForEach(results) { result in
                    row(icon: "mappin", label: result.label, trailing: result.type.capitalized) { select(result) }
                }
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // Shadow on the shape only - see shadCardBackground.
            RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous)
                .fill(Theme.popover)
                .shadow(color: .black.opacity(0.15), radius: 16, y: 6)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }

    private func row(icon: String, label: String, trailing: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground).frame(width: 16)
                    .accessibilityHidden(true)
                Text(label).font(.bodyText).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                if let trailing {
                    Text(trailing).font(.geist(11, relativeTo: .caption2)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(DropdownRowStyle())
    }

    private func scheduleSearch(_ text: String) {
        searchTask?.cancel()
        guard text.count >= 2 else {
            results = []
            isLoading = false
            return
        }
        isLoading = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            let found = (try? await environment.api.searchLocations(matching: text)) ?? []
            guard !Task.isCancelled else { return }
            results = found
            isLoading = false
        }
    }

    private func select(_ result: LocationSearchResult) {
        recents = Self.saveRecent(result, key: storageKey)
        apply(PlannerLocation(label: result.label, coordinate: result.coordinate))
    }

    /// Like the web (`getCurrentPosition` with a 10s timeout): waits for a
    /// fix rather than failing when one isn't cached yet.
    private func useCurrentLocation() {
        environment.location.requestPermission()
        environment.location.startUpdating()
        isFocused = false
        isLocating = true
        Task {
            var coordinate = environment.location.coordinate
            var waited = 0
            while coordinate == nil && waited < 20 {
                try? await Task.sleep(for: .milliseconds(500))
                waited += 1
                coordinate = environment.location.coordinate
            }
            guard let coordinate else {
                isLocating = false
                environment.toasts.show("Unable to access your current location.", .error)
                return
            }
            let label = (try? await environment.api.reverseGeocode(coordinate).name) ?? "Current location"
            isLocating = false
            apply(PlannerLocation(label: label, coordinate: coordinate))
        }
    }

    private func apply(_ picked: PlannerLocation) {
        searchTask?.cancel()
        suppressNextQueryChange = picked.label != query
        location = picked
        query = picked.label
        results = []
        isFocused = false
    }

    // MARK: - Recents (UserDefaults, one list per field)

    private static let maxRecents = 5

    /// Also used by the step-by-step planner's place search, so both share
    /// one recents list per field.
    static func loadRecents(_ key: String) -> [LocationSearchResult] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let decoded = try? JSONDecoder().decode([LocationSearchResult].self, from: data) else { return [] }
        return decoded
    }

    static func saveRecent(_ result: LocationSearchResult, key: String) -> [LocationSearchResult] {
        let updated = Array(([result] + loadRecents(key).filter { $0.id != result.id }).prefix(maxRecents))
        if let data = try? JSONEncoder().encode(updated) {
            UserDefaults.standard.set(data, forKey: key)
        }
        return updated
    }
}
