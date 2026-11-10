import { Stack, useLocalSearchParams } from "expo-router"
import { StopBoardView } from "@/components/stop-board"

/** A stop's departure board, full screen. */
export default function StopBoard() {
    const { query } = useLocalSearchParams<{ query: string }>()
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <StopBoardView query={query ?? ""} />
        </>
    )
}
