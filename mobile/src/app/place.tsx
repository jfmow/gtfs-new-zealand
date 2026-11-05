import { Stack, router, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { ScrollView, StyleSheet, TextInput, View } from "react-native"
import { getRegionSlug } from "@transit/shared/regions"
import { LocationResults, type PickedPlace } from "@/components/location-search"
import { Button, SearchField, SectionLabel } from "@/components/ui"
import { useRegion } from "@/lib/region"
import { useSavedPlaces, type PlaceKind } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/** Save a place (home, work, or a named one) - iOS `SavedPlacesViews`. */
export default function PlaceEditor() {
    const colors = useColors()
    const { kind = "other" } = useLocalSearchParams<{ kind?: PlaceKind }>()
    const { region } = useRegion()
    const places = useSavedPlaces(getRegionSlug(region))
    const [query, setQuery] = useState("")
    const [picked, setPicked] = useState<PickedPlace | null>(null)
    const [name, setName] = useState("")
    const title = kind === "home" ? "Set home" : kind === "work" ? "Set work" : "Add a place"

    const save = () => {
        if (!picked) return
        places.save({ kind, label: kind === "home" ? "Home" : kind === "work" ? "Work" : name.trim() || picked.label, lat: picked.lat, lon: picked.lon })
        router.back()
    }

    return (
        <>
            <Stack.Screen options={{ title, presentation: "modal" }} />
            <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <SearchField value={picked ? picked.label : query} onChangeText={(t) => { setPicked(null); setQuery(t) }} placeholder="Search for an address or place" autoFocus accessibilityLabel="Search places" />
                {!picked ? <LocationResults query={query} onPick={(p) => { setPicked(p); setName(p.label) }} /> : null}
                {picked && kind === "other" ? (
                    <>
                        <SectionLabel>Name</SectionLabel>
                        <TextInput value={name} onChangeText={setName} accessibilityLabel="Place name" style={[type.body, styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} />
                    </>
                ) : null}
                <View style={{ height: spacing.lg }} />
                <Button title="Save" onPress={save} disabled={!picked} />
                {kind !== "other" && places.places.some((p) => p.kind === kind) ? (
                    <Button title={`Remove ${kind}`} variant="ghost" onPress={() => { places.remove(kind); router.back() }} style={{ marginTop: spacing.sm }} />
                ) : null}
            </ScrollView>
        </>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg },
    input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44 },
})
