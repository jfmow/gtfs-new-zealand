import SwiftData
import SwiftUI
import TransitCore

let walkSpeedChoices: [(value: Double, title: String)] = [(3, "Slow"), (4.8, "Normal"), (5.5, "Brisk")]
let maxWalkChoices: [(value: Double, title: String)] = [(0.5, "0.5 km"), (1, "1 km"), (2, "2 km"), (5, "5 km")]
let transferChoices: [(value: Int, title: String)] = [(0, "Direct only"), (1, "Up to 1"), (2, "Up to 2"), (3, "Up to 3"), (4, "Up to 4"), (5, "Up to 5")]
let resultCountChoices: [(value: Int, title: String)] = [(3, "3 journeys"), (5, "5 journeys"), (8, "8 journeys")]

func walkSpeedLabel(_ speed: Double) -> String {
    walkSpeedChoices.first { $0.value == speed }?.title ?? "Normal"
}

extension SavedTrip {
    var onlyRoutes: [RouteSearchResult] {
        zip(onlyRouteIDs, onlyRouteNames.count == onlyRouteIDs.count ? onlyRouteNames : onlyRouteIDs)
            .map { RouteSearchResult(name: $1, routeID: $0) }
    }

    func setOnlyRoutes(_ routes: [RouteSearchResult]) {
        onlyRouteIDs = routes.map(\.routeID)
        onlyRouteNames = routes.map(\.name)
    }

    /// "1 km · Normal · ≤2 transfers" - the web manage sheet's detail line.
    var optionsSummary: String {
        let walk = maxWalkKm == maxWalkKm.rounded() ? String(Int(maxWalkKm)) : String(maxWalkKm)
        let transfers = maxTransfers == 0 ? "Direct" : "≤\(maxTransfers) transfers"
        return "\(walk) km · \(walkSpeedLabel(walkSpeed)) · \(transfers)"
    }
}

// MARK: - Rail (quick-trips-rail.tsx)

struct QuickTripsRail: View {
    let trips: [SavedTrip]
    let onLoad: (SavedTrip) -> Void

    @Environment(\.modelContext) private var modelContext
    @Environment(AppEnvironment.self) private var environment

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Saved trips").font(.metaMedium).foregroundStyle(Theme.mutedForeground)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(trips.enumerated()), id: \.element.persistentModelID) { index, trip in
                        TripCard(
                            trip: trip,
                            canMoveLeft: index > 0,
                            canMoveRight: index < trips.count - 1,
                            onLoad: { onLoad(trip) },
                            onMove: { move(from: index, by: $0) },
                            onDelete: {
                                modelContext.delete(trip)
                                environment.toasts.show("Trip deleted")
                            }
                        )
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func move(from index: Int, by offset: Int) {
        var ordered = trips
        let target = index + offset
        guard ordered.indices.contains(target) else { return }
        ordered.swapAt(index, target)
        for (i, trip) in ordered.enumerated() { trip.sortOrder = i }
    }
}

private struct TripCard: View {
    @Bindable var trip: SavedTrip
    let canMoveLeft: Bool
    let canMoveRight: Bool
    let onLoad: () -> Void
    let onMove: (Int) -> Void
    let onDelete: () -> Void

    @State private var isRenaming = false
    @State private var draftName = ""

    var body: some View {
        let accent = Color(hex: trip.colorHex)
        Button(action: onLoad) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "point.topleft.down.to.point.bottomright.curvepath").font(.system(size: 11, weight: .semibold)).foregroundStyle(accent)
                    Text(trip.name).font(.bodyMedium).foregroundStyle(Theme.foreground).lineLimit(1)
                }
                Text("\(trip.startLabel) → \(trip.endLabel)")
                    .font(.meta)
                    .foregroundStyle(Theme.mutedForeground)
                    .lineLimit(1)
            }
            .padding(12)
            .frame(width: 200, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
            .overlay(alignment: .leading) {
                UnevenRoundedRectangle(topLeadingRadius: Theme.radiusLG, bottomLeadingRadius: Theme.radiusLG, style: .continuous)
                    .fill(accent).frame(width: 3)
            }
            .overlay(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Theme.radiusLG, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                draftName = trip.name
                isRenaming = true
            } label: { Label("Rename", systemImage: "pencil") }
            SwatchMenu(selectedHex: trip.colorHex) { trip.colorHex = $0 }
            if canMoveLeft { Button { onMove(-1) } label: { Label("Move left", systemImage: "arrow.left") } }
            if canMoveRight { Button { onMove(1) } label: { Label("Move right", systemImage: "arrow.right") } }
            Divider()
            Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
        }
        .alert("Rename trip", isPresented: $isRenaming) {
            TextField("Trip name", text: $draftName)
            Button("Save") {
                let trimmed = draftName.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty { trip.name = trimmed }
            }
            Button("Cancel", role: .cancel) {}
        }
        .accessibilityHint("Loads this trip. Touch and hold for options.")
    }
}

/// The swatch picker inside a context menu.
struct SwatchMenu: View {
    let selectedHex: String
    let onSelect: (String) -> Void

    var body: some View {
        Menu {
            ForEach(Swatches.all, id: \.hex) { swatch in
                Button { onSelect(swatch.hex) } label: {
                    if swatch.hex == selectedHex { Label(swatch.name, systemImage: "checkmark") } else { Text(swatch.name) }
                }
            }
        } label: { Label("Colour", systemImage: "paintpalette") }
    }
}

/// The colour row inside an edit form - round swatches, ring on the chosen one.
struct SwatchPicker: View {
    @Binding var selectedHex: String

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Swatches.all, id: \.hex) { swatch in
                Button { selectedHex = swatch.hex } label: {
                    Circle().fill(Color(hex: swatch.hex)).frame(width: 26, height: 26)
                        .overlay(Circle().strokeBorder(Theme.foreground.opacity(swatch.hex == selectedHex ? 0.6 : 0), lineWidth: 2).padding(-4))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(swatch.name)
                .accessibilityAddTraits(swatch.hex == selectedHex ? .isSelected : [])
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Save (save-trip-dialog.tsx)

struct SaveTripSheet: View {
    let start: PlannerLocation
    let end: PlannerLocation
    let onSave: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("\(start.label) → \(end.label)")
                    .font(.meta).foregroundStyle(Theme.mutedForeground).lineLimit(2)
                TextField("Trip name", text: $name)
                    .textFieldStyle(.shad())
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(save)
                Spacer()
            }
            .padding(16)
            .pageBackground()
            .navigationTitle("Save trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                name = "\(shortLabel(start.label)) → \(shortLabel(end.label))"
                focused = true
            }
        }
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        onSave(trimmed)
        dismiss()
    }

    /// Search labels look like "Name 12 Street Suburb City Postcode" - keep
    /// the part before the street number for a short default name.
    private func shortLabel(_ label: String) -> String {
        if let range = label.rangeOfCharacter(from: .decimalDigits) {
            let prefix = label[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
            if !prefix.isEmpty { return prefix }
        }
        return label
    }
}

// MARK: - Manage (manage-trips-sheet.tsx)

struct ManageTripsSheet: View {
    let onLoad: (SavedTrip) -> Void

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var environment
    @Query(sort: \SavedTrip.sortOrder) private var trips: [SavedTrip]
    @State private var editing: SavedTrip?
    @State private var confirmingDelete: SavedTrip?

    var body: some View {
        NavigationStack {
            Group {
                if trips.isEmpty {
                    EmptyState(systemImage: "bookmark", title: "No saved trips yet", message: "Plan a journey and tap the bookmark to save it here.")
                } else {
                    List {
                        ForEach(trips) { trip in
                            Button {
                                onLoad(trip)
                                dismiss()
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Circle().fill(Color(hex: trip.colorHex)).frame(width: 8, height: 8)
                                        Text(trip.name).font(.bodyMedium).lineLimit(1)
                                    }
                                    Text("\(trip.startLabel) → \(trip.endLabel)").font(.geist(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                                    Text(trip.optionsSummary).font(.geist(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground.opacity(0.7))
                                    if !trip.onlyRouteIDs.isEmpty {
                                        Text("Only: \(trip.onlyRoutes.map(\.name).joined(separator: ", "))")
                                            .font(.geist(12, relativeTo: .caption)).foregroundStyle(Theme.mutedForeground.opacity(0.7)).lineLimit(1)
                                    }
                                }
                                .padding(.vertical, 4)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .listRowBackground(Theme.card)
                            .swipeActions {
                                Button("Delete", role: .destructive) { confirmingDelete = trip }
                                Button("Edit") { editing = trip }.tint(Theme.mutedForeground)
                            }
                            .contextMenu {
                                Button { editing = trip } label: { Label("Edit", systemImage: "pencil") }
                                Button(role: .destructive) { confirmingDelete = trip } label: { Label("Delete", systemImage: "trash") }
                            }
                        }
                        .onMove { from, to in
                            var ordered = trips
                            ordered.move(fromOffsets: from, toOffset: to)
                            for (i, trip) in ordered.enumerated() { trip.sortOrder = i }
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .environment(\.editMode, .constant(.active))
                }
            }
            .pageBackground()
            .navigationTitle("Saved trips (\(trips.count))")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(item: $editing) { trip in
                EditTripSheet(trip: trip).shadSheet(detents: [.large])
            }
            .alert("Delete trip?", isPresented: Binding(get: { confirmingDelete != nil }, set: { if !$0 { confirmingDelete = nil } })) {
                Button("Delete", role: .destructive) {
                    if let trip = confirmingDelete {
                        modelContext.delete(trip)
                        environment.toasts.show("Trip deleted")
                    }
                    confirmingDelete = nil
                }
                Button("Cancel", role: .cancel) { confirmingDelete = nil }
            } message: {
                Text("This trip will be permanently removed.")
            }
        }
    }
}

private struct EditTripSheet: View {
    @Bindable var trip: SavedTrip
    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var environment
    @State private var name = ""
    @State private var colorHex = ""
    @State private var maxWalkKm: Double = 1
    @State private var walkSpeed: Double = 4.8
    @State private var maxTransfers = 5
    @State private var onlyRoutes: [RouteSearchResult] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    TextField("Trip name", text: $name).textFieldStyle(.shad())
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Colour").font(.meta).foregroundStyle(Theme.mutedForeground)
                        SwatchPicker(selectedHex: $colorHex)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        ShadSelect(label: "Max walk:", selection: $maxWalkKm, options: maxWalkChoices, fullWidth: true)
                        ShadSelect(label: "Speed:", selection: $walkSpeed, options: walkSpeedChoices, fullWidth: true)
                        ShadSelect(label: "Transfers:", selection: $maxTransfers, options: transferChoices, fullWidth: true)
                    }
                    RouteMultiSelect(selected: $onlyRoutes)
                }
                .padding(16)
            }
            .pageBackground()
            .navigationTitle("Edit trip")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let trimmed = name.trimmingCharacters(in: .whitespaces)
                        if !trimmed.isEmpty { trip.name = trimmed }
                        trip.colorHex = colorHex
                        trip.maxWalkKm = maxWalkKm
                        trip.walkSpeed = walkSpeed
                        trip.maxTransfers = maxTransfers
                        trip.setOnlyRoutes(onlyRoutes)
                        environment.toasts.show("Trip updated")
                        dismiss()
                    }
                }
            }
            .onAppear {
                name = trip.name
                colorHex = trip.colorHex
                maxWalkKm = maxWalkChoices.contains { $0.value == trip.maxWalkKm } ? trip.maxWalkKm : 1
                walkSpeed = walkSpeedChoices.contains { $0.value == trip.walkSpeed } ? trip.walkSpeed : 4.8
                maxTransfers = trip.maxTransfers
                onlyRoutes = trip.onlyRoutes
            }
        }
    }
}

// MARK: - Update all (global-trip-settings-dialog.tsx)

struct GlobalTripSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppEnvironment.self) private var environment
    @Query private var trips: [SavedTrip]

    @State private var applyWalk = false
    @State private var applySpeed = false
    @State private var applyTransfers = false
    @State private var applyRoutes = false
    @State private var maxWalkKm: Double = 1
    @State private var walkSpeed: Double = 4.8
    @State private var maxTransfers = 5
    @State private var onlyRoutes: [RouteSearchResult] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Select settings to apply to all \(trips.count) saved trip\(trips.count == 1 ? "" : "s").")
                        .font(.meta).foregroundStyle(Theme.mutedForeground)
                    row("Max walk", isOn: $applyWalk) { ShadSelect(selection: $maxWalkKm, options: maxWalkChoices) }
                    row("Walk speed", isOn: $applySpeed) { ShadSelect(selection: $walkSpeed, options: walkSpeedChoices) }
                    row("Transfers", isOn: $applyTransfers) { ShadSelect(selection: $maxTransfers, options: transferChoices) }
                    row("Only use these routes", isOn: $applyRoutes) { EmptyView() }
                    if applyRoutes {
                        RouteMultiSelect(label: "", selected: $onlyRoutes)
                    }
                }
                .padding(16)
            }
            .pageBackground()
            .navigationTitle("Update all trips")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        for trip in trips {
                            if applyWalk { trip.maxWalkKm = maxWalkKm }
                            if applySpeed { trip.walkSpeed = walkSpeed }
                            if applyTransfers { trip.maxTransfers = maxTransfers }
                            if applyRoutes { trip.setOnlyRoutes(onlyRoutes) }
                        }
                        environment.toasts.show("Updated \(trips.count) trip\(trips.count == 1 ? "" : "s")")
                        dismiss()
                    }
                    .disabled(!(applyWalk || applySpeed || applyTransfers || applyRoutes) || trips.isEmpty)
                }
            }
        }
    }

    private func row<Control: View>(_ label: String, isOn: Binding<Bool>, @ViewBuilder control: () -> Control) -> some View {
        HStack(spacing: 10) {
            Button {
                isOn.wrappedValue.toggle()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: isOn.wrappedValue ? "checkmark.square.fill" : "square")
                        .font(.system(size: 18))
                        .foregroundStyle(isOn.wrappedValue ? Theme.primary : Theme.mutedForeground)
                    Text(label).font(.bodyText).foregroundStyle(isOn.wrappedValue ? Theme.foreground : Theme.mutedForeground)
                }
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(isOn.wrappedValue ? .isSelected : [])
            Spacer(minLength: 8)
            control()
        }
        .frame(minHeight: 36)
    }
}
