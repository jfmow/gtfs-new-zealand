import SwiftData
import SwiftUI
import TransitCore

// Building blocks for the step-by-step planner: clear type that grows with
// the rider's text size, roomy tap targets, words beside every icon, one
// question per screen.

extension Font {
    static let easyQuestion = geist(24, .semibold, relativeTo: .title)
    static let easyChoice = geist(17, .semibold, relativeTo: .headline)
    static let easyBody = geist(16, relativeTo: .body)
    static let easyBodyMedium = geist(16, .medium, relativeTo: .body)
}

/// One question: "Question 2 of 4", the question in large type, the
/// answers, and a full-width button pinned to the bottom.
struct EasyQuestionScreen<Content: View>: View {
    let number: Int
    let title: String
    let buttonTitle: String
    let canContinue: Bool
    let onContinue: () -> Void
    @ViewBuilder let content: Content

    @AccessibilityFocusState private var titleFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Question \(number) of 4")
                        .font(.easyBodyMedium)
                        .foregroundStyle(Theme.mutedForeground)
                    Text(title)
                        .font(.easyQuestion)
                        .foregroundStyle(Theme.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($titleFocused)
                }
                .accessibilityElement(children: .combine)
                content
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            EasyPrimaryButton(title: buttonTitle, isEnabled: canContinue, action: onContinue)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Theme.background)
        }
        .pageBackground()
        .onAppear { titleFocused = true }
    }
}

struct EasyPrimaryButton: View {
    let title: String
    var systemImage: String?
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let systemImage { Image(systemName: systemImage).accessibilityHidden(true) }
                Text(title)
            }
            .font(.easyChoice)
            .foregroundStyle(Theme.primaryForeground)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Theme.primary.opacity(isEnabled ? 1 : 0.35), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }
}

struct EasySecondaryButton: View {
    let title: String
    var systemImage: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let systemImage { Image(systemName: systemImage).accessibilityHidden(true) }
                Text(title).multilineTextAlignment(.center)
            }
            .font(.easyChoice)
            .foregroundStyle(Theme.foreground)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 12)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A large answer card - an icon, words, and a tick when chosen.
struct EasyChoiceCard: View {
    let title: String
    var subtitle: String?
    let systemImage: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .medium))
                    .frame(width: 28)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.easyChoice)
                    if let subtitle {
                        Text(subtitle).font(.easyBody).foregroundStyle(Theme.mutedForeground)
                    }
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? Theme.primary : Theme.border)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Theme.foreground)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(isSelected ? Theme.accent : Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(isSelected ? Theme.primary : Theme.border, lineWidth: isSelected ? 2 : 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// The chosen place, with a way to change it.
struct EasySelectedPlace: View {
    let place: PlannerLocation
    let onChange: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(Theme.danger)
                    .accessibilityHidden(true)
                Text(place.label)
                    .font(.easyChoice)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            EasySecondaryButton(title: "Choose a different place", systemImage: "arrow.uturn.backward", action: onChange)
        }
        .padding(16)
        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.primary, lineWidth: 2))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Chosen: \(place.label)")
    }
}

/// Search for a place, with saved and recent places underneath - the
/// planner's `LocationField`, laid out as a page rather than a dropdown.
struct EasyPlaceSearch: View {
    let prompt: String
    /// Which planner recents to use: `recentEndLocations` or `recentStartLocations`.
    let storageKey: String
    /// Saved trips' places to offer first, e.g. every saved destination.
    let savedPlaces: [PlannerLocation]
    let onPick: (PlannerLocation) -> Void

    @Environment(AppEnvironment.self) private var environment
    @State private var query = ""
    @State private var results: [LocationSearchResult] = []
    @State private var recents: [LocationSearchResult] = []
    @State private var isLoading = false
    @State private var searchTask: Task<Void, Never>?
    @State private var isPickingOnMap = false
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Theme.mutedForeground)
                    .accessibilityHidden(true)
                TextField(prompt, text: $query)
                    .font(.easyChoice)
                    .focused($isFocused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .onSubmit { if let first = results.first { pick(first) } }
                    .onChange(of: query) { _, text in scheduleSearch(text) }
                if isLoading {
                    ProgressView()
                } else if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Text("Clear").font(.easyBodyMedium)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.live)
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(isFocused ? Theme.ring : Theme.input, lineWidth: 1)
            )

            if query.count >= 2 {
                searchResults
            } else {
                suggestions
            }
        }
        .onAppear { recents = LocationField.loadRecents(storageKey) }
        .sheet(isPresented: $isPickingOnMap) {
            MapLocationPickerView(initialCoordinate: nil) { onPick($0) }
        }
    }

    @ViewBuilder
    private var searchResults: some View {
        if results.isEmpty {
            Text(isLoading ? "Searching…" : "No places found. Try another name, or a street address.")
                .font(.easyBody)
                .foregroundStyle(Theme.mutedForeground)
        } else {
            VStack(spacing: 10) {
                ForEach(results) { result in
                    placeRow(icon: "mappin", label: result.label) { pick(result) }
                }
            }
        }
    }

    private var suggestions: some View {
        VStack(alignment: .leading, spacing: 20) {
            if !savedPlaces.isEmpty {
                group("Your saved places") {
                    ForEach(savedPlaces, id: \.self) { place in
                        placeRow(icon: "star.fill", label: place.label) { onPick(place) }
                    }
                }
            }
            if !recents.isEmpty {
                group("Places you've searched for") {
                    ForEach(recents) { recent in
                        placeRow(icon: "clock", label: recent.label) {
                            onPick(PlannerLocation(label: recent.label, coordinate: recent.coordinate))
                        }
                    }
                }
            }
            placeRow(icon: "map", label: "Pick the place on a map") { isPickingOnMap = true }
        }
    }

    private func group(_ title: String, @ViewBuilder rows: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.easyBodyMedium).foregroundStyle(Theme.mutedForeground)
                .accessibilityAddTraits(.isHeader)
            rows()
        }
    }

    private func placeRow(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                Text(label)
                    .font(.easyBodyMedium)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Theme.foreground)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            let found = (try? await environment.api.searchLocations(matching: text, limit: 8)) ?? []
            guard !Task.isCancelled else { return }
            results = found
            isLoading = false
        }
    }

    private func pick(_ result: LocationSearchResult) {
        recents = LocationField.saveRecent(result, key: storageKey)
        isFocused = false
        onPick(PlannerLocation(label: result.label, coordinate: result.coordinate))
    }
}
