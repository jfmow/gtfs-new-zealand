import { Stack, useLocalSearchParams } from "expo-router"
import { ScrollView } from "react-native"
import { cleanStopName } from "@transit/shared/formatting"
import { AlertList } from "@/components/alerts"
import { EmptyState, ErrorText, Loading } from "@/components/ui"
import { useStopAlerts } from "@/lib/queries"
import { spacing, useColors } from "@/theme"
import { readable, useLayout } from "@/lib/layout"

/** A stop's service alerts (the web's /alerts?s=). */
export default function StopAlerts() {
    const colors = useColors()
    const { wide } = useLayout()
    const { stop } = useLocalSearchParams<{ stop: string }>()
    const alerts = useStopAlerts(stop ?? null)
    return (
        <>
            <Stack.Screen options={{ title: cleanStopName(stop ?? "Alerts") }} />
            <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[{ padding: spacing.lg }, readable(wide)]}>
                {alerts.isLoading ? <Loading /> : null}
                {alerts.error ? <ErrorText>{(alerts.error as Error).message}</ErrorText> : null}
                {alerts.data && Object.values(alerts.data.alerts ?? {}).flat().length === 0 ? <EmptyState title="No alerts here" /> : null}
                {alerts.data ? <AlertList byRoute={alerts.data.alerts ?? {}} /> : null}
            </ScrollView>
        </>
    )
}
