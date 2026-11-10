import BottomSheet, { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import type { ReactNode } from "react"
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useLayout } from "@/lib/layout"
import { spacing, useColors } from "@/theme"

/** How far below the safe area a side panel starts: clear of a screen's 52 pt glass top bar. */
export const PANEL_TOP = spacing.sm + 52 + spacing.md

/**
 * The card over a full-screen map: a bottom drawer on phones, and on wide
 * windows a floating panel down the leading side (iOS `MapSidePanel`), so
 * the map keeps the rest of the screen. Screens give the map
 * `left: panelInset(...)` padding on wide windows so it centres in the
 * clear part.
 */
export function MapDrawer({ children, snapPoints, index, onChange, contentContainerStyle }: {
    children: ReactNode
    snapPoints: (string | number)[]
    index: number
    onChange?: (index: number) => void
    contentContainerStyle?: StyleProp<ViewStyle>
}) {
    const colors = useColors()
    const insets = useSafeAreaInsets()
    const { wide, panelWidth } = useLayout()

    if (wide) {
        return (
            // Shadow outside, clipping inside - iOS drops the shadow of a view that clips.
            <View style={[styles.panel, { top: insets.top + PANEL_TOP, bottom: insets.bottom + spacing.lg, left: insets.left + spacing.lg, width: panelWidth, backgroundColor: colors.background }]}>
                <View style={[styles.clip, { borderColor: colors.border }]}>
                    <ScrollView contentContainerStyle={[{ paddingTop: spacing.lg, paddingBottom: spacing.xl }, contentContainerStyle]}>{children}</ScrollView>
                </View>
            </View>
        )
    }
    return (
        <BottomSheet snapPoints={snapPoints} index={index} onChange={onChange} backgroundStyle={{ backgroundColor: colors.background }} handleIndicatorStyle={{ backgroundColor: colors.mutedForeground, width: 40 }}>
            <BottomSheetScrollView contentContainerStyle={[{ paddingBottom: insets.bottom + 40 }, contentContainerStyle]}>{children}</BottomSheetScrollView>
        </BottomSheet>
    )
}

/** The map's leading padding when a side panel covers it. */
export function panelInset(panelWidth: number, insetLeft = 0): number {
    return insetLeft + spacing.lg + panelWidth
}

const styles = StyleSheet.create({
    panel: {
        position: "absolute",
        borderRadius: 24,
        shadowColor: "#000",
        shadowOpacity: 0.15,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
    },
    clip: { flex: 1, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
})
