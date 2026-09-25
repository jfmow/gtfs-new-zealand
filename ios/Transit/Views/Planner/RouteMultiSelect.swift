import SwiftUI
import TransitCore

/// "Only use these routes" - `components/journey/route-filter.tsx`. Selected
/// routes show as removable chips; "Add route" opens a searchable sheet
/// (`/routes/find-route/{q}`, same endpoint as the web).
struct RouteMultiSelect: View {
    var label = "Only use these routes"
    @Binding var selected: [RouteSearchResult]

    @State private var isAdding = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !label.isEmpty {
                Text(label).font(.meta).foregroundStyle(Theme.mutedForeground)
            }
            FlowLayout(spacing: 6, lineSpacing: 6) {
                ForEach(selected, id: \.routeID) { route in
                    HStack(spacing: 4) {
                        Text(route.name).font(.geist(13, .medium, relativeTo: .footnote)).lineLimit(1)
                        Button {
                            selected.removeAll { $0.routeID == route.routeID }
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove route \(route.name)")
                    }
                    .padding(.leading, 10)
                    .padding(.trailing, 8)
                    .frame(minHeight: 30)
                    .background(Theme.secondary, in: Capsule())
                }
                Button {
                    isAdding = true
                } label: {
                    // Not a Label: inside a Form row it collapses to its icon.
                    HStack(spacing: 4) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                        Text(selected.isEmpty ? "Add route" : "Add")
                    }
                    .font(.geist(13, .medium, relativeTo: .footnote))
                    .fixedSize()
                }
                .buttonStyle(.shad(.outline, size: .sm))
            }
        }
        .sheet(isPresented: $isAdding) {
            RouteSearchSheet(selected: $selected)
                .shadSheet(detents: [.medium, .large])
        }
    }
}

/// Search routes and tick the ones you want - the planner's route filter
/// and the vehicles map's "where's my bus".
struct RouteSearchSheet: View {
    var title = "Only use these routes"
    @Binding var selected: [RouteSearchResult]

    @Environment(AppEnvironment.self) private var environment
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [RouteSearchResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                TextField("Search routes…", text: $query)
                    .textFieldStyle(.shad(icon: "magnifyingglass"))
                    .focused($focused)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .onChange(of: query) { _, newValue in search(newValue) }

                ScrollView {
                    LazyVStack(spacing: 0) {
                        if isSearching && results.isEmpty {
                            Text("Searching…").font(.meta).foregroundStyle(Theme.mutedForeground).padding(.vertical, 24)
                        } else if query.count >= 1 && results.isEmpty {
                            Text("No routes found").font(.meta).foregroundStyle(Theme.mutedForeground).padding(.vertical, 24)
                        }
                        ForEach(results, id: \.routeID) { route in
                            let isSelected = selected.contains { $0.routeID == route.routeID }
                            Button {
                                if isSelected {
                                    selected.removeAll { $0.routeID == route.routeID }
                                } else {
                                    selected.append(route)
                                }
                            } label: {
                                HStack {
                                    Text(route.name).font(.bodyText)
                                    Spacer()
                                    if isSelected { Image(systemName: "checkmark").foregroundStyle(Theme.foreground) }
                                }
                                .padding(.horizontal, 12)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(DropdownRowStyle())
                        }
                    }
                }
            }
            .padding(16)
            .pageBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .onAppear { focused = true }
        }
    }

    private func search(_ text: String) {
        searchTask?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            results = []
            return
        }
        isSearching = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            let found = (try? await environment.api.findRoute(matching: trimmed)) ?? []
            guard !Task.isCancelled else { return }
            results = found
            isSearching = false
        }
    }
}
