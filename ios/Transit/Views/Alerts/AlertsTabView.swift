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
                HStack(spacing: 8) {
                    StopSearchField { selectedStop = $0 }
                    Button {
                        isShowingSubscription = true
                    } label: {
                        Image(systemName: "bell.badge").font(.system(size: 15))
                    }
                    .buttonStyle(.shad(.secondary, size: .icon))
                    .frame(height: 44)
                    .disabled(selectedStop == nil)
                    .accessibilityLabel("Notifications for this stop")
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
                .zIndex(1)

                if let selectedStop {
                    HStack {
                        Text(selectedStop).font(.pageTitle).lineLimit(1)
                        Spacer()
                        Button("Clear") { self.selectedStop = nil }.buttonStyle(.shad(.ghost, size: .sm))
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
