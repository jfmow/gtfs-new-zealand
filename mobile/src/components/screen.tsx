import { Link } from "expo-router"
import { SymbolView } from "expo-symbols"
import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { spacing, type, useColors } from "@/theme"

/** A tab's page: title, the Settings gear, then content. */
export function Screen({ title, children }: { title: string; children?: ReactNode }) {
    const colors = useColors()
    return (
        <SafeAreaView edges={["top", "left", "right"]} style={[styles.page, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <Text accessibilityRole="header" style={[type.pageTitle, { color: colors.foreground }]}>{title}</Text>
                <Link href="/settings" asChild>
                    <Pressable accessibilityLabel="Settings" hitSlop={12}>
                        <SymbolView name={{ ios: "gearshape", android: "settings", web: "settings" }} tintColor={colors.foreground} size={22} />
                    </Pressable>
                </Link>
            </View>
            <View style={styles.content}>{children}</View>
        </SafeAreaView>
    )
}

/** Stand-in for a screen that lands in a later phase of plans/expo-app.md. */
export function ComingSoon({ phase, what }: { phase: number; what: string }) {
    const colors = useColors()
    return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[type.cardTitle, { color: colors.foreground }]}>Coming in phase {phase}</Text>
            <Text style={[type.body, { color: colors.mutedForeground, marginTop: spacing.xs }]}>{what}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    page: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    content: { flex: 1, paddingHorizontal: spacing.lg },
    card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: spacing.lg },
})
