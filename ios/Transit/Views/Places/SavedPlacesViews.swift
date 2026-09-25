import SwiftData
import SwiftUI
import TransitCore

/// The icons a saved place can have - stored on `SavedPlace.icon` by raw
/// value, so don't rename cases.
enum SavedPlaceIcon: String, CaseIterable, Identifiable {
    case home, work, heart, person, school, gym, shop, food, star, pin

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .home: "house.fill"
        case .work: "briefcase.fill"
        case .heart: "heart.fill"
        case .person: "person.fill"
        case .school: "graduationcap.fill"
        case .gym: "dumbbell.fill"
        case .shop: "cart.fill"
        case .food: "fork.knife"
        case .star: "star.fill"
        case .pin: "mappin"
        }
    }

    var title: String {
        switch self {
        case .home: "Home"
        case .work: "Work"
        case .heart: "Partner"
        case .person: "Friend or family"
        case .school: "School"
        case .gym: "Gym"
        case .shop: "Shops"
        case .food: "Food"
        case .star: "Favourite"
        case .pin: "Other"
        }
    }

    /// A tint per icon, so a row of places is easy to tell apart at a glance.
    var colorHex: String {
        switch self {
        case .home: "0ea5e9"
        case .work: "f59e0b"
        case .heart: "f43f5e"
        case .person: "8b5cf6"
        case .school: "10b981"
        case .gym: "f97316"
        case .shop: "06b6d4"
        case .food: "d946ef"
        case .star: "f59e0b"
        case .pin: "737373"
        }
    }
}

extension SavedPlace {
    var placeIcon: SavedPlaceIcon { SavedPlaceIcon(rawValue: icon) ?? .pin }

    /// As a planner endpoint - labelled with the place's name, so the
    /// planner, saved trips and the tracker say "Home" rather than an
    /// address.
    var plannerLocation: PlannerLocation { PlannerLocation(label: name, coordinate: coordinate) }

    func matches(_ query: String) -> Bool {
        let query = query.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return true }
        return name.localizedCaseInsensitiveContains(query) || address.localizedCaseInsensitiveContains(query)
    }
}

/// The rounded tile with a place's icon on its tint.
struct SavedPlaceTile: View {
    let icon: SavedPlaceIcon
    var size: CGFloat = 36

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(Color(hex: icon.colorHex).opacity(0.18))
            .overlay(
                Image(systemName: icon.systemImage)
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Color(hex: icon.colorHex))
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// MARK: - Add / edit

/// Add a place (optionally starting from a preset like "Home") or edit one:
/// a name, an icon, and the location - searched, "My location", or picked
/// on the map via the planner's own field.
struct SavedPlaceEditorSheet: View {
    /// nil to add a new place.
    var place: SavedPlace?
    var presetName = ""
    var presetIcon: SavedPlaceIcon = .pin

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var environment
    @State private var name = ""
    @State private var icon: SavedPlaceIcon = .pin
    @State private var location: PlannerLocation?
    @State private var confirmingDelete = false
    @State private var didLoad = false

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }
    private var canSave: Bool { !trimmedName.isEmpty && location != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    field("Location") {
                        LocationField(placeholder: "Search for an address or place", storageKey: "recentPlaceLocations",
                                      location: $location, showsSavedPlaces: false)
                    }
                    .zIndex(1)

                    field("Name") {
                        TextField("e.g. Home, Work, Sam's place", text: $name)
                            .textFieldStyle(.shad(height: 44))
                            .submitLabel(.done)
                    }

                    field("Icon") {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                            ForEach(SavedPlaceIcon.allCases) { option in
                                iconButton(option)
                            }
                        }
                    }

                    if place != nil {
                        Button(role: .destructive) { confirmingDelete = true } label: {
                            Label("Delete place", systemImage: "trash")
                        }
                        .buttonStyle(.shad(.outline, size: .default, fullWidth: true))
                        .foregroundStyle(Theme.danger)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .pageBackground()
            .navigationTitle(place == nil ? "Add place" : "Edit place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(!canSave).fontWeight(.semibold)
                }
            }
            .confirmationDialog("Delete \(place?.name ?? "this place")?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let place { modelContext.delete(place) }
                    environment.toasts.show("Place deleted")
                    dismiss()
                }
            }
            .onAppear(perform: load)
        }
    }

    private func field(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.metaMedium).foregroundStyle(Theme.mutedForeground)
            content()
        }
    }

    private func iconButton(_ option: SavedPlaceIcon) -> some View {
        let selected = option == icon
        return Button {
            icon = option
            // Naming by icon, until the rider types their own name.
            if trimmedName.isEmpty || SavedPlaceIcon.allCases.contains(where: { $0.title == trimmedName }) {
                if option != .pin && option != .star { name = option.title }
            }
        } label: {
            SavedPlaceTile(icon: option, size: 44)
                .overlay(
                    RoundedRectangle(cornerRadius: 44 * 0.28 + 3, style: .continuous)
                        .strokeBorder(selected ? Theme.foreground.opacity(0.7) : .clear, lineWidth: 2)
                        .padding(-4)
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func load() {
        guard !didLoad else { return }
        didLoad = true
        if let place {
            name = place.name
            icon = place.placeIcon
            location = PlannerLocation(label: place.address, coordinate: place.coordinate)
        } else {
            name = presetName
            icon = presetIcon
        }
    }

    private func save() {
        guard let location, canSave else { return }
        if let place {
            place.name = trimmedName
            place.icon = icon.rawValue
            place.address = location.label
            place.coordinate = location.coordinate
        } else {
            let count = (try? modelContext.fetchCount(FetchDescriptor<SavedPlace>())) ?? 0
            modelContext.insert(SavedPlace(
                name: trimmedName, address: location.label, coordinate: location.coordinate,
                icon: icon.rawValue, regionSlug: environment.region.slug, sortOrder: count
            ))
            environment.toasts.show("Saved \(trimmedName)")
        }
        dismiss()
    }
}

// MARK: - Manage

/// Every saved place in this region - tap to edit, drag to reorder, swipe
/// to delete, + to add.
struct ManagePlacesSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(AppEnvironment.self) private var environment
    @Query(sort: \SavedPlace.sortOrder) private var allPlaces: [SavedPlace]
    @State private var editing: SavedPlace?
    @State private var isAdding = false

    private var places: [SavedPlace] { allPlaces.filter { $0.regionSlug == environment.region.slug } }

    var body: some View {
        NavigationStack {
            List {
                ForEach(places) { place in
                    Button { editing = place } label: {
                        HStack(spacing: 12) {
                            SavedPlaceTile(icon: place.placeIcon, size: 32)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(place.name).font(.bodyMedium).foregroundStyle(Theme.foreground)
                                Text(place.address).font(.meta).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(Theme.card)
                }
                .onMove(perform: move)
                .onDelete(perform: delete)
            }
            .scrollContentBackground(.hidden)
            .groupedPageBackground()
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Places")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { isAdding = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Add place")
                }
                DoneButton()
            }
            .overlay {
                if places.isEmpty {
                    EmptyState(systemImage: "mappin.and.ellipse", title: "No saved places",
                               message: "Save places like Home or Work to plan trips to them in one tap.")
                }
            }
            .sheet(item: $editing) { place in
                SavedPlaceEditorSheet(place: place).shadSheet(detents: [.large])
            }
            .sheet(isPresented: $isAdding) {
                SavedPlaceEditorSheet().shadSheet(detents: [.large])
            }
        }
    }

    private func move(from source: IndexSet, to destination: Int) {
        var ordered = places
        ordered.move(fromOffsets: source, toOffset: destination)
        for (i, place) in ordered.enumerated() { place.sortOrder = i }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets { modelContext.delete(places[index]) }
    }
}

// MARK: - Home row

/// Home's "Places" row: one chip per saved place (tap = plan a trip there
/// from here), then an add chip. With none saved yet, offers Home and Work.
struct SavedPlacesRow: View {
    let places: [SavedPlace]
    let onGo: (SavedPlace) -> Void
    let onEdit: (SavedPlace) -> Void
    let onAdd: (_ name: String, _ icon: SavedPlaceIcon) -> Void

    @Environment(\.modelContext) private var modelContext
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(places, id: \.persistentModelID) { place in
                    Button { onGo(place) } label: {
                        chipLabel { SavedPlaceTile(icon: place.placeIcon, size: 28) } text: { Text(place.name).foregroundStyle(Theme.foreground) }
                            .shadCardBackground(radius: 22)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { onGo(place) } label: { Label("Plan a trip here", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                        Button { onEdit(place) } label: { Label("Edit", systemImage: "pencil") }
                        Divider()
                        Button(role: .destructive) {
                            modelContext.delete(place)
                            environment.toasts.show("Place deleted")
                        } label: { Label("Delete", systemImage: "trash") }
                    }
                    .accessibilityLabel(place.name)
                    .accessibilityHint("Plans a trip to \(place.address) from your location. Touch and hold for options.")
                }

                if !places.contains(where: { $0.placeIcon == .home }) {
                    addChip("Home", icon: .home)
                }
                if !places.contains(where: { $0.placeIcon == .work }) {
                    addChip("Work", icon: .work)
                }
                addChip(nil, icon: .pin)
            }
            .padding(.vertical, 2)
        }
        .contentMargins(.horizontal, 16, for: .scrollContent)
    }

    private func addChip(_ name: String?, icon: SavedPlaceIcon) -> some View {
        Button { onAdd(name ?? "", icon) } label: {
            chipLabel {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 28, height: 28)
                    .background(Theme.muted, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            } text: {
                Text(name.map { "Add \($0.lowercased())" } ?? "Add place").foregroundStyle(Theme.mutedForeground)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            )
        }
        .buttonStyle(.plain)
    }

    private func chipLabel(@ViewBuilder icon: () -> some View, @ViewBuilder text: () -> some View) -> some View {
        HStack(spacing: 8) {
            icon()
            text().font(.bodyMedium).lineLimit(1)
        }
        .padding(.leading, 6)
        .padding(.trailing, 14)
        .padding(.vertical, 6)
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}
