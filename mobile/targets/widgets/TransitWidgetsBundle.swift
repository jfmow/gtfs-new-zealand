import WidgetKit
import SwiftUI

@main
struct TransitWidgetsBundle: WidgetBundle {
    var body: some Widget {
        JourneyLiveActivity()
        DeparturesWidget()
    }
}
