import SwiftUI
import TransitCore

/// The Alerts tab - `pages/alerts.tsx`: stop search and a "Notifications"
/// button for that stop's alert subscription, with the stop's alerts shown
/// right on the page (the web keeps them on the same route via `?s=`).
struct AlertsTabView: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var selectedStop: String?
    @State private var isShowingSubscription = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                StopSearchField { selectedStop = $0 }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .zIndex(1)

                if let selectedStop {
                    HStack(spacing: 8) {
                        Text(selectedStop).font(.pageTitle).lineLimit(2)
                        Spacer(minLength: 8)
                        Button {
                            isShowingSubscription = true
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "bell.badge").font(.system(size: 12, weight: .medium))
                                Text("Get alerts")
                            }
                        }
                        .buttonStyle(.shad(.outline, size: .sm))
                        Button {
                            self.selectedStop = nil
                        } label: {
                            Image(systemName: "xmark").font(.system(size: 12, weight: .semibold))
                        }
                        .buttonStyle(.shad(.ghost, size: .iconSm))
                        .accessibilityLabel("Clear stop")
                    }
                    .padding(.horizontal, 16)
                    AlertsView(stopQuery: selectedStop, title: selectedStop, standalone: false)
                        .frame(maxHeight: .infinity, alignment: .top)
                } else {
                    EmptyState(systemImage: "exclamationmark.bubble", title: "Travel alerts",
                               message: "Search for a stop to view alerts.")
                        .frame(maxHeight: .infinity, alignment: .top)
                }
            }
            .pageBackground()
            .navigationTitle("Alerts")
            .navigationBarTitleDisplayMode(.inline)
            .appToolbar()
            .sheet(isPresented: $isShowingSubscription) {
                if let selectedStop {
                    AlertSubscriptionSheet(target: .stop(query: selectedStop, title: selectedStop)).shadSheet(detents: [.large])
                }
            }
        }
    }
}
