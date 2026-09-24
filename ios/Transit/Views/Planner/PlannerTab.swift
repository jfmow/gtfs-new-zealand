import SwiftUI

/// Which planner the Planner tab shows - Settings' "Planner".
enum PlannerStyle: String, CaseIterable {
    case standard, stepByStep

    static let storageKey = "plannerStyle"

    var label: String {
        switch self {
        case .standard: "Standard"
        case .stepByStep: "Step by step"
        }
    }
}

/// The Planner tab: the standard planner, or the step-by-step one for riders
/// who'd rather answer a few questions. A re-plan from the tracker or a
/// reminder's `/plan` link needs the standard planner's form, so in
/// step-by-step mode those open it over the tab.
struct PlannerTab: View {
    @AppStorage(PlannerStyle.storageKey) private var styleRaw = PlannerStyle.standard.rawValue
    @Environment(DeepLinkRouter.self) private var router
    @State private var showsStandardPlanner = false

    private var style: PlannerStyle { PlannerStyle(rawValue: styleRaw) ?? .standard }

    var body: some View {
        switch style {
        case .standard:
            PlannerView()
        case .stepByStep:
            EasyPlannerFlow()
                .onChange(of: router.pendingPlan != nil || router.pendingReplan != nil, initial: true) { _, pending in
                    if pending { showsStandardPlanner = true }
                }
                .fullScreenCover(isPresented: $showsStandardPlanner) {
                    PlannerView(onClose: { showsStandardPlanner = false })
                }
        }
    }
}
