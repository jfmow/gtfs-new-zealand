import SwiftUI
import TransitCore

/// Stop search - `components/stops/search.tsx`. The results float over the
/// page as a dropdown card (nothing below reflows while typing), empty focus
/// shows "Recent searches" with a remove button on each, and results carry
/// the web's stop-type tag ("Bus Stop", "Train Station").
///
/// Put this *outside* any ScrollView and give its container a higher
/// `zIndex` than the content below, so the dropdown draws over it.
struct StopSearchField: View {
    var placeholder = "Search for stop..."
    /// Called with the stop's "name code" query string - what
    /// `/services/{stop}` and `StopBoardView` expect.
    let onSelect: (String) -> Void

    @Environment(AppEnvironment.self) private var environment
    @FocusState private var isFocused: Bool
    @State private var text = ""
    @State private var results: [StopSearchResult] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var recents: [String] = RecentStopSearches.load()

    private var isOpen: Bool { isFocused && (text.count >= 2 || (text.isEmpty && !recents.isEmpty)) }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.mutedForeground)
                .accessibilityHidden(true)
            TextField(placeholder, text: $text)
                .font(.bodyText)
                .focused($isFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
                .onChange(of: text) { _, newValue in scheduleSearch(newValue) }
                .onSubmit { if let first = results.first { select(first.name) } }
            if !text.isEmpty {
                Button {
                    text = ""
                    results = []
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.mutedForeground)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 44)
        .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous)
                .strokeBorder(isFocused ? Theme.ring.opacity(0.6) : Theme.input, lineWidth: 1)
        )
        .overlay(alignment: .topLeading) {
            if isOpen {
                dropdown
                    .offset(y: 50)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.12), value: isOpen)
    }

    private var dropdown: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                if text.isEmpty {
                    Text("Recent searches")
                        .font(.metaMedium)
                        .foregroundStyle(Theme.mutedForeground)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                    ForEach(recents, id: \.self) { recent in
                        HStack(spacing: 0) {
                            Button { select(recent) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "clock").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                                        .accessibilityHidden(true)
                                    Text(recent).font(.bodyText).lineLimit(1)
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 10)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(DropdownRowStyle())
                            Button {
                                recents = RecentStopSearches.remove(recent)
                            } label: {
                                Image(systemName: "xmark").font(.system(size: 12, weight: .medium))
                            }
                            .buttonStyle(.shad(.ghost, size: .iconSm))
                            .foregroundStyle(Theme.mutedForeground)
                            .accessibilityLabel("Remove \(recent) from recent searches")
                        }
                    }
                } else if isLoading && results.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
                } else if let errorMessage {
                    Text(errorMessage).font(.meta).foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity).padding(16)
                } else if results.isEmpty {
                    Text(text.count > 2 ? "No results found" : "Type at least 2 characters to search")
                        .font(.meta).foregroundStyle(Theme.mutedForeground)
                        .frame(maxWidth: .infinity).padding(16)
                } else {
                    ForEach(results) { result in
                        Button { select(result.name) } label: {
                            HStack(spacing: 10) {
                                Text(result.name).font(.bodyText).lineLimit(1)
                                Spacer(minLength: 8)
                                Text(Self.typeLabel(result.typeOfStop))
                                    .font(.meta)
                                    .foregroundStyle(Theme.mutedForeground)
                            }
                            .padding(.horizontal, 10)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(DropdownRowStyle())
                    }
                }
            }
            .padding(6)
        }
        .frame(maxHeight: 300)
        .fixedSize(horizontal: false, vertical: true)
        .background {
            // Shadow on the shape only - see shadCardBackground.
            RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous)
                .fill(Theme.popover)
                .shadow(color: .black.opacity(0.15), radius: 16, y: 6)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.radiusMD, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
    }

    static func typeLabel(_ type: String) -> String {
        switch type.lowercased() {
        case "bus": return "Bus Stop"
        case "train": return "Train Station"
        case "ferry": return "Ferry Terminal"
        default: return "Stop"
        }
    }

    private func scheduleSearch(_ query: String) {
        searchTask?.cancel()
        errorMessage = nil
        guard query.count >= 2 else {
            results = []
            isLoading = false
            return
        }
        isLoading = true
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                let found = try await environment.api.findStop(matching: query)
                guard !Task.isCancelled else { return }
                results = found
            } catch {
                guard !Task.isCancelled else { return }
                results = []
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func select(_ name: String) {
        searchTask?.cancel()
        recents = RecentStopSearches.add(name)
        isFocused = false
        text = ""
        results = []
        onSelect(name)
    }
}

/// `variant="ghost"` rows inside a dropdown - highlight on press only.
struct DropdownRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Theme.foreground)
            .background(configuration.isPressed ? Theme.accent : .clear, in: RoundedRectangle(cornerRadius: Theme.radiusSM, style: .continuous))
    }
}

/// The web keeps these in localStorage under `recentStopSearches`, newest
/// first, max 5.
enum RecentStopSearches {
    private static let key = "recentStopSearches"
    private static let max = 5

    static func load() -> [String] {
        UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    @discardableResult
    static func add(_ name: String) -> [String] {
        let updated = Array(([name] + load().filter { $0 != name }).prefix(max))
        UserDefaults.standard.set(updated, forKey: key)
        return updated
    }

    @discardableResult
    static func remove(_ name: String) -> [String] {
        let updated = load().filter { $0 != name }
        UserDefaults.standard.set(updated, forKey: key)
        return updated
    }
}
