import { Stack, router, useLocalSearchParams } from "expo-router"
import { View } from "react-native"
import { JourneyMap } from "@/components/journey"
import { HeaderTextButton, Loading } from "@/components/ui"
import { usePlan } from "@/lib/plans"

/** The journey's route full screen - iOS "Journey map", pannable and zoomable, with your location. */
export default function JourneyMapScreen() {
    const { id } = useLocalSearchParams<{ id: string }>()
    const { data: plan } = usePlan(id)
    return (
        <>
            <Stack.Screen
                options={{
                    title: "Journey map",
                    headerRight: () => <HeaderTextButton title="Done" side="right" bold onPress={() => router.back()} />,
                }}
            />
            <View style={{ flex: 1 }}>{plan ? <JourneyMap plan={plan} showUser padding={{ top: 60, bottom: 60, left: 50, right: 50 }} /> : <Loading />}</View>
        </>
    )
}
