import SwiftUI
import TransitCore

/// First launch: pick the region (or have location pick it), then location
/// and notifications - each asked with a line on why, rather than a cold
/// system prompt the moment Home appears - then which planner to use.
struct OnboardingView: View {
    let onFinish: () -> Void

    @Environment(AppEnvironment.self) private var environment
    @AppStorage(PlannerStyle.storageKey) private var plannerStyleRaw = PlannerStyle.standard.rawValue
    @State private var step = Step.region
    @State private var isLocating = false

    enum Step: Int, CaseIterable { case region, location, notifications, planner }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                ForEach(Step.allCases, id: \.self) { item in
                    Capsule()
                        .fill(item.rawValue <= step.rawValue ? Theme.primary : Theme.border)
                        .frame(height: 3)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .accessibilityHidden(true)

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    content
                }
                .padding(24)
                .frame(maxWidth: 520, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)

            footer
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
        }
        .pageBackground()
        .animation(.snappy, value: step)
        // A permission answered in the system prompt moves things on.
        .onChange(of: environment.location.coordinate) { _, coordinate in
            guard isLocating, let coordinate else { return }
            isLocating = false
            environment.choose(region: nearestRegion(to: coordinate))
        }
        .onChange(of: environment.location.authorizationStatus) { _, status in
            if status == .denied || status == .restricted { isLocating = false }
        }
    }

    // MARK: - Steps

    @ViewBuilder
    private var content: some View {
        switch step {
        case .region:
            header(icon: "tram.fill", title: "Welcome to Transit",
                   message: "Live departures, journey planning and alerts. Where do you travel?")
            VStack(spacing: 8) {
                ForEach(Region.all) { region in
                    choiceRow(title: region.displayName, detail: nil, isSelected: environment.region == region) {
                        environment.choose(region: region)
                    }
                }
            }
            Button {
                isLocating = true
                environment.location.requestPermission()
                environment.location.startUpdating()
                if let here = environment.location.coordinate {
                    isLocating = false
                    environment.choose(region: nearestRegion(to: here))
                }
            } label: {
                HStack(spacing: 6) {
                    if isLocating { ProgressView().controlSize(.small) } else { Image(systemName: "location") }
                    Text("Use my location")
                }
            }
            .buttonStyle(.shad(.ghost, size: .sm))

        case .location:
            header(icon: "location.fill", title: "Stops near you",
                   message: "Your location shows the stops around you with their next departures, times your walks, and follows a journey you're on - even with no mobile data.")
            bullet("Only while you're using the app, or tracking a journey.")
            bullet("Never stored or shared.")

        case .notifications:
            header(icon: "bell.fill", title: "Know when to go",
                   message: "Get a nudge when it's time to leave, when your stop is next, and when something changes on a route you use.")
            bullet("Reminders you set, and alerts for stops you choose.")
            bullet("Turn any of them off in Settings.")

        case .planner:
            header(icon: "point.topleft.down.to.point.bottomright.curvepath", title: "How do you like to plan?",
                   message: "You can change this any time in Settings.")
            VStack(spacing: 8) {
                choiceRow(title: "Standard", detail: "From, To and options on one screen",
                          isSelected: plannerStyleRaw == PlannerStyle.standard.rawValue) {
                    plannerStyleRaw = PlannerStyle.standard.rawValue
                }
                choiceRow(title: "Step by step", detail: "A few simple questions, one at a time",
                          isSelected: plannerStyleRaw == PlannerStyle.stepByStep.rawValue) {
                    plannerStyleRaw = PlannerStyle.stepByStep.rawValue
                }
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        VStack(spacing: 6) {
            switch step {
            case .region:
                Button("Continue") { advance() }
                    .buttonStyle(.shad(.default, size: .lg, fullWidth: true))
            case .location:
                if environment.location.isAuthorized {
                    Button("Continue") { advance() }
                        .buttonStyle(.shad(.default, size: .lg, fullWidth: true))
                } else {
                    Button("Allow location") {
                        environment.location.requestPermission()
                        advance()
                    }
                    .buttonStyle(.shad(.default, size: .lg, fullWidth: true))
                    Button("Not now") { advance() }.buttonStyle(.shad(.ghost, size: .default, fullWidth: true))
                }
            case .notifications:
                if environment.push.isAuthorized {
                    Button("Continue") { advance() }
                        .buttonStyle(.shad(.default, size: .lg, fullWidth: true))
                } else {
                    Button("Allow notifications") {
                        Task {
                            _ = await environment.push.requestPermission()
                            advance()
                        }
                    }
                    .buttonStyle(.shad(.default, size: .lg, fullWidth: true))
                    Button("Not now") { advance() }.buttonStyle(.shad(.ghost, size: .default, fullWidth: true))
                }
            case .planner:
                Button("Get started") { onFinish() }
                    .buttonStyle(.shad(.default, size: .lg, fullWidth: true))
            }
        }
    }

    private func advance() {
        if let next = Step(rawValue: step.rawValue + 1) { step = next } else { onFinish() }
    }

    // MARK: - Pieces

    private func header(icon: String, title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.foreground)
                .frame(width: 48, height: 48)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
            Text(title)
                .font(.geist(24, .semibold, relativeTo: .title))
                .accessibilityAddTraits(.isHeader)
            Text(message)
                .font(.bodyText)
                .foregroundStyle(Theme.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 12)
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.success)
            Text(text).font(.bodyText).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func choiceRow(title: String, detail: String?, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.bodyMedium).foregroundStyle(Theme.foreground)
                    if let detail {
                        Text(detail).font(.meta).foregroundStyle(Theme.mutedForeground)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(isSelected ? Theme.primary : Theme.border)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusXL, style: .continuous)
                    .strokeBorder(isSelected ? Theme.primary : Theme.border, lineWidth: isSelected ? 1.5 : 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func nearestRegion(to coordinate: Coordinate) -> Region {
        Region.all.min {
            Geo.haversineDistanceMeters($0.defaultMapCenter, coordinate) < Geo.haversineDistanceMeters($1.defaultMapCenter, coordinate)
        } ?? .auckland
    }
}
