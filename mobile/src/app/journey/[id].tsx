import { router, useLocalSearchParams } from "expo-router"
import { useEffect } from "react"
import { JourneyDetailView } from "@/components/journey-detail"

/** One planned journey, full screen (the Planner shows it beside the results on wide windows). */
export default function JourneyDetail() {
    const { id, remind } = useLocalSearchParams<{ id: string; remind?: string }>()
    // The step-by-step planner's "Remind me when to leave" opens straight onto the sheet.
    useEffect(() => {
        if (remind === "1" && id) router.push({ pathname: "/leave-reminder", params: { id } })
    }, [remind, id])
    return <JourneyDetailView id={id ?? ""} />
}
