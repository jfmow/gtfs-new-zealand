import { Stack, router, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Text, TextInput, View } from "react-native"
import { getRegionSlug } from "@transit/shared/regions"
import { HeaderTextButton } from "@/components/ui"
import { planContext } from "@/lib/plans"
import { useRegion } from "@/lib/region"
import { useSavedTrips } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/** Search labels look like "Name 12 Street Suburb" - keep the part before the street number. */
function shortLabel(label: string) {
    const i = label.search(/\d/)
    const s = (i > 0 ? label.slice(0, i) : label).trim().replace(/,$/, "")
    return s || label
}

/** "Save trip" - iOS `SaveTripSheet`: name this start → destination to plan it again in one tap. */
export default function SaveTrip() {
    const colors = useColors()
    const { id, fromLabel, fromLat, fromLon, toLabel, toLat, toLon } = useLocalSearchParams<{ id?: string; fromLabel?: string; fromLat?: string; fromLon?: string; toLabel?: string; toLat?: string; toLon?: string }>()
    const { region } = useRegion()
    const { save } = useSavedTrips(getRegionSlug(region))
    const ctx = id ? planContext(id) : undefined
    const from = ctx?.start ?? (fromLat && fromLon ? { label: fromLabel ?? "Start", lat: Number(fromLat), lon: Number(fromLon) } : null)
    const to = ctx?.end ?? (toLat && toLon ? { label: toLabel ?? "Destination", lat: Number(toLat), lon: Number(toLon) } : null)
    const [name, setName] = useState(from && to ? `${shortLabel(from.label)} → ${shortLabel(to.label)}` : "")
    const valid = !!from && !!to && name.trim().length > 0
    const done = () => {
        if (!valid) return
        save({ name: name.trim(), from: from!, to: to! })
        router.back()
    }
    return (
        <>
            <Stack.Screen
                options={{
                    title: "Save trip",
                    headerLeft: () => <HeaderTextButton title="Cancel" side="left" onPress={() => router.back()} />,
                    headerRight: () => <HeaderTextButton title="Save" side="right" bold disabled={!valid} onPress={done} />,
                }}
            />
            <View style={{ flex: 1, padding: spacing.lg, gap: 14, backgroundColor: colors.background }}>
                <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={2}>{from?.label ?? "?"} → {to?.label ?? "?"}</Text>
                <TextInput
                    value={name}
                    onChangeText={setName}
                    autoFocus
                    placeholder="Trip name"
                    placeholderTextColor={colors.mutedForeground}
                    returnKeyType="done"
                    onSubmitEditing={done}
                    accessibilityLabel="Trip name"
                    style={[type.body, { fontSize: 17, color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}
                />
            </View>
        </>
    )
}
