import { useEffect, useState } from "react";
import type { MapTheme } from "./tile-layer";

/**
 * The basemap normally follows the app's light/dark theme. This override lets
 * the user pin it independently from the settings page - "auto" defers to the
 * app theme, "light"/"dark" force that basemap regardless.
 */
export type MapThemeOverride = "auto" | "light" | "dark";

const KEY = "map:themeOverride";
const EVENT = "map:themeOverride-change";

export function getMapThemeOverride(): MapThemeOverride {
    if (typeof window === "undefined") return "auto";
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
}

export function setMapThemeOverride(value: MapThemeOverride) {
    window.localStorage.setItem(KEY, value);
    // Notify same-tab listeners (the `storage` event only fires in other tabs).
    window.dispatchEvent(new CustomEvent(EVENT));
}

export function resolveMapTheme(override: MapThemeOverride, appTheme: MapTheme): MapTheme {
    return override === "auto" ? appTheme : override;
}

/** Live map-theme override, re-rendering the caller whenever it changes. */
export function useMapThemeOverride(): MapThemeOverride {
    const [override, setOverride] = useState<MapThemeOverride>("auto");
    useEffect(() => {
        const sync = () => setOverride(getMapThemeOverride());
        sync();
        window.addEventListener(EVENT, sync);
        window.addEventListener("storage", sync);
        return () => {
            window.removeEventListener(EVENT, sync);
            window.removeEventListener("storage", sync);
        };
    }, []);
    return override;
}
