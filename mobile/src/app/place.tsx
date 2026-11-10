import { Stack, router, useLocalSearchParams } from "expo-router"
import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { getRegionSlug } from "@transit/shared/regions"
import { Check } from "@/components/icons"
import { LocationResults, type PickedPlace } from "@/components/location-search"
import { PLACE_COLORS, PLACE_ICONS, placeStyle } from "@/components/place-style"
import { Button, SearchField, SectionLabel } from "@/components/ui"
import { readable, useLayout } from "@/lib/layout"
import { useRegion } from "@/lib/region"
import { useSavedPlaces, type PlaceKind } from "@/lib/saved"
import { radius, spacing, type, useColors } from "@/theme"

/**
 * Save or edit a place (home, work, or a named one) - iOS `SavedPlacesViews`,
 * plus an icon and colour of the rider's choosing. `id` edits a saved place;
 * otherwise `kind` says what to add.
 */
export default function PlaceEditor() {
    const colors = useColors()
    const { wide } = useLayout()
    const params = useLocalSearchParams<{ kind?: PlaceKind; id?: string }>()
    const { region } = useRegion()
    const places = useSavedPlaces(getRegionSlug(region))
    const existing = places.places.find((p) => p.id === (params.id ?? (params.kind !== "other" ? params.kind : undefined)))
    const kind: PlaceKind = existing?.kind ?? params.kind ?? "other"
    const [query, setQuery] = useState("")
    const [picked, setPicked] = useState<PickedPlace | null>(existing ? { label: existing.label, lat: existing.lat, lon: existing.lon } : null)
    const [name, setName] = useState(existing?.label ?? "")
    const initial = placeStyle(existing ?? { kind })
    const [icon, setIcon] = useState(initial.iconId)
    const [color, setColor] = useState(initial.color)
    const style = placeStyle({ kind, icon, color })
    const Icon = style.icon
    const title = existing
        ? `Edit ${kind === "home" ? "home" : kind === "work" ? "work" : existing.label}`
        : kind === "home" ? "Set home" : kind === "work" ? "Set work" : "Add a place"

    const save = () => {
        if (!picked) return
        places.save({
            id: existing?.id,
            kind,
            label: kind === "home" ? "Home" : kind === "work" ? "Work" : name.trim() || picked.label,
            lat: picked.lat,
            lon: picked.lon,
            icon,
            color,
        })
        router.back()
    }

    return (
        <>
            <Stack.Screen options={{ title, presentation: "modal" }} />
            <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={[styles.content, readable(wide)]} keyboardShouldPersistTaps="handled">
                <View style={styles.preview} accessible accessibilityLabel={`${kind === "other" ? name || "Place" : kind === "home" ? "Home" : "Work"} icon preview`}>
                    <View style={[styles.previewCircle, { backgroundColor: color + "33" }]}><Icon size={26} color={color} /></View>
                    <Text style={[type.cardTitle, { color: colors.foreground }]} numberOfLines={1}>{kind === "home" ? "Home" : kind === "work" ? "Work" : name.trim() || picked?.label || "New place"}</Text>
                </View>

                <SectionLabel>Location</SectionLabel>
                <SearchField value={picked ? picked.label : query} onChangeText={(t) => { setPicked(null); setQuery(t) }} placeholder="Search for an address or place" autoFocus={!existing} accessibilityLabel="Search places" />
                {!picked ? <LocationResults query={query} onPick={(p) => { setPicked(p); if (!name.trim()) setName(p.label) }} /> : null}

                {kind === "other" ? (
                    <>
                        <SectionLabel>Name</SectionLabel>
                        <TextInput value={name} onChangeText={setName} placeholder="Gym, school, Mum's…" placeholderTextColor={colors.mutedForeground} accessibilityLabel="Place name"
                            style={[type.body, styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} />
                    </>
                ) : null}

                <SectionLabel>Icon</SectionLabel>
                <View style={styles.grid} accessibilityRole="radiogroup">
                    {PLACE_ICONS.map((it) => {
                        const selected = it.id === icon
                        const I = it.icon
                        return (
                            <Pressable key={it.id} accessibilityRole="radio" accessibilityLabel={it.label} accessibilityState={{ selected }} onPress={() => setIcon(it.id)}
                                style={[styles.iconCell, { backgroundColor: selected ? color + "33" : colors.card, borderColor: selected ? color : colors.border }]}>
                                <I size={20} color={selected ? color : colors.mutedForeground} />
                            </Pressable>
                        )
                    })}
                </View>

                <SectionLabel>Colour</SectionLabel>
                <View style={styles.grid} accessibilityRole="radiogroup">
                    {PLACE_COLORS.map((c) => {
                        const selected = c === color
                        return (
                            <Pressable key={c} accessibilityRole="radio" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected }} onPress={() => setColor(c)}
                                style={[styles.swatch, { backgroundColor: c, borderColor: selected ? colors.foreground : "transparent" }]}>
                                {selected ? <Check size={16} color="#fff" /> : null}
                            </Pressable>
                        )
                    })}
                </View>

                <View style={{ height: spacing.xl }} />
                <Button title="Save" onPress={save} disabled={!picked} />
                {existing ? (
                    <Button title={`Remove ${kind === "other" ? existing.label : kind}`} variant="ghost" onPress={() => { places.remove(existing.id); router.back() }} style={{ marginTop: spacing.sm }} />
                ) : null}
            </ScrollView>
        </>
    )
}

const styles = StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: 60 },
    preview: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
    previewCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
    input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    iconCell: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, alignItems: "center", justifyContent: "center" },
})
