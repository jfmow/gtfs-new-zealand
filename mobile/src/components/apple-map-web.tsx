"use dom"

import { useDOMImperativeHandle, type DOMImperativeFactory } from "expo/dom"
import { useEffect, useRef, type Ref } from "react"
import type { Bounds, MapLine, MarkerView } from "./map-types"

type JSONValue = Parameters<DOMImperativeFactory[string]>[number]

/**
 * Android's Apple map: MapKit JS (the web's Apple Maps) in an Expo DOM
 * component. It draws the same lines and markers as iOS's native MapKit -
 * markers as small HTML elements matching `marker-body.tsx`. MapKit JS has
 * no pitch, so there's no 3D here.
 *
 * Everything crossing the bridge is plain data; taps and camera moves come
 * back through the native-action props.
 */

declare global {
    // MapKit JS ships no types here.
    interface Window { mapkit?: any; __mapkitReady?: Promise<any> }
}

export interface WebMarker {
    id: string
    lat: number
    lon: number
    view: MarkerView
    anchor?: "center" | "bottom"
    label?: string
    tappable?: boolean
    zIndex?: number
}

/** A camera command from the app - plain JSON, as the bridge needs. */
export type CameraCommand =
    | { op: "easeTo"; lon: number | null; lat: number | null; zoom: number | null; rotation?: number | null; animated: boolean }
    | { op: "fitBounds"; bounds: Bounds; top: number; right: number; bottom: number; left: number; animated?: boolean }

export interface AppleMapWebCamera extends DOMImperativeFactory {
    run: (...args: JSONValue[]) => void
}

interface Props {
    ref?: Ref<AppleMapWebCamera>
    /** A fresh MapKit JS token - MapKit asks again whenever one runs out. */
    getToken: () => Promise<string>
    center: { lat: number; lon: number }
    zoom: number
    bounds: Bounds | null
    padding: { top: number; bottom: number; left: number; right: number }
    interactive: boolean
    dark: boolean
    lines: MapLine[]
    markers: WebMarker[]
    /** Native actions - always async, data only. */
    onRegion: (center: { lat: number; lon: number }, zoom: number, bounds: Bounds, byUser: boolean) => Promise<void>
    onMapPress: () => Promise<void>
    onMarkerPress: (id: string) => Promise<void>
    onReady: () => Promise<void>
    dom?: import("expo/dom").DOMProps
}

const MODE_COLORS: Record<string, string> = { train: "#0073bd", ferry: "#2a286b", bus: "#64748b" }
const SVG: Record<string, string> = {
    bus: "M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z",
    train: "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
    ferry: "M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z",
    navigation: "M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z",
    pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
}
const modeKey = (mode: string) => (/train|rail/i.test(mode) ? "train" : /ferry/i.test(mode) ? "ferry" : "bus")
const icon = (name: string, size: number, color: string, rotate = 0) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="display:block;transform:rotate(${rotate}deg)"><path fill="${color}" d="${SVG[name]}"/></svg>`
const hex = (c: string | undefined, fallback: string) => (c ? (c.startsWith("#") ? c : `#${c}`) : fallback)
function textOn(bg: string) {
    const h = bg.replace("#", "")
    if (h.length < 6) return "#fff"
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? "#111" : "#fff"
}
const SHADOW = "box-shadow:0 1px 3px rgba(0,0,0,.25);"
const FONT = "font-family:system-ui,-apple-system,Roboto,sans-serif;"

/** The HTML for a marker - the same drawings as `marker-body.tsx`. */
function markerHTML(v: MarkerView): string {
    switch (v.type) {
        case "cluster":
            return `<div style="display:flex;flex-direction:column;align-items:center">
                <div style="min-width:30px;height:30px;padding:0 5px;box-sizing:border-box;border-radius:15px;background:${v.color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;${FONT}font-weight:600;font-size:${v.count > 99 ? 11 : 13}px;${SHADOW}">${v.count}</div>
                <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${v.color};margin-top:-2px"></div></div>`
        case "stop": {
            const k = modeKey(v.mode)
            return `<div style="width:28px;height:28px;box-sizing:border-box;border-radius:14px;background:${MODE_COLORS[k]};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;${SHADOW}">${icon(k, 14, "#fff")}</div>`
        }
        case "vehicleTag": {
            const bg = hex(v.color, "#0D1A12")
            const fg = textOn(bg)
            const glyph = v.bearing ? icon("navigation", 11, fg, v.bearing) : icon(modeKey(v.mode), 12, fg)
            return `<div style="display:flex;align-items:center;gap:3px;height:26px;padding:0 7px;box-sizing:border-box;border-radius:13px;background:${bg};border:2px solid #fff;color:${fg};${FONT}font-weight:700;font-size:12px;white-space:nowrap;${SHADOW}">${glyph}<span>${v.label}</span></div>`
        }
        case "vehicle":
            return `<div style="width:40px;height:40px;box-sizing:border-box;border-radius:20px;background:${v.color};border:3px solid #fff;display:flex;align-items:center;justify-content:center;${SHADOW}">${icon(modeKey(v.mode), 18, textOn(v.color))}</div>`
        case "dot":
            return `<div style="width:${v.size}px;height:${v.size}px;box-sizing:border-box;border-radius:50%;background:${v.fill};border:${v.strokeWidth}px solid ${v.stroke}"></div>`
        case "pin":
            return `<div style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.3))">${icon("pin", 34, v.color)}</div>`
        case "badge":
            return `<div style="min-width:30px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:6px;background:${v.color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;color:${textOn(v.color)};${FONT}font-weight:600;font-size:11px">${v.text}</div>`
    }
}

function heightOf(v: MarkerView): number {
    switch (v.type) {
        case "cluster": return 34
        case "stop": return 28
        case "vehicleTag": return 26
        case "vehicle": return 40
        case "dot": return v.size
        case "pin": return 34
        case "badge": return 22
    }
}

function loadMapKit(getToken: () => Promise<string>): Promise<any> {
    if (!window.__mapkitReady) {
        window.__mapkitReady = new Promise((resolve, reject) => {
            const script = document.createElement("script")
            script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js"
            script.crossOrigin = "anonymous"
            script.dataset.libraries = "map,annotations,overlays"
            script.dataset.callback = "__mapkitLoaded"
            ;(window as any).__mapkitLoaded = () => {
                window.mapkit.init({ authorizationCallback: (done: (t: string) => void) => { getToken().then(done, () => done("")) }, language: "en-NZ" })
                resolve(window.mapkit)
            }
            script.onerror = () => reject(new Error("MapKit JS failed to load"))
            document.head.appendChild(script)
        })
    }
    return window.__mapkitReady
}

const spanForZoom = (zoom: number, widthPx: number) => (360 * widthPx) / (512 * 2 ** zoom)
const zoomForSpan = (lonDelta: number, widthPx: number) => Math.log2((360 * widthPx) / (512 * Math.max(lonDelta, 1e-9)))

function regionFor(mk: any, el: HTMLElement | null, c: { lat: number; lon: number }, zoom: number) {
    const w = el?.clientWidth || 400
    const h = el?.clientHeight || 800
    const lonDelta = spanForZoom(zoom, w)
    return new mk.CoordinateRegion(new mk.Coordinate(c.lat, c.lon), new mk.CoordinateSpan(lonDelta * (h / w) * Math.cos((c.lat * Math.PI) / 180), lonDelta))
}
const regionOfBounds = (mk: any, b: Bounds) =>
    new mk.CoordinateRegion(new mk.Coordinate((b[1] + b[3]) / 2, (b[0] + b[2]) / 2), new mk.CoordinateSpan(b[3] - b[1], b[2] - b[0]))

type Drawn = { annotations: Map<string, { ann: any; key: string }>; overlays: any[] }

/** Draw lines and markers: overlays are cheap to redraw; annotations are kept by id and only rebuilt when they change. */
function draw(mk: any, m: any, p: Props, drawn: Drawn, onMarkerPress: (id: string) => void) {
    m.colorScheme = p.dark ? mk.Map.ColorSchemes.Dark : mk.Map.ColorSchemes.Light
    if (drawn.overlays.length) m.removeOverlays(drawn.overlays)
    drawn.overlays = p.lines.filter((l) => l.coords.length > 1).map((l) =>
        new mk.PolylineOverlay(l.coords.map((c) => new mk.Coordinate(c.lat, c.lon)), {
            style: new mk.Style({ strokeColor: l.color, lineWidth: l.width ?? (l.dashed ? 4 : 5), lineCap: "round", lineJoin: "round", lineDash: l.dashed ? [1, 8] : [] }),
        }),
    )
    if (drawn.overlays.length) m.addOverlays(drawn.overlays)

    const seen = new Set<string>()
    for (const mm of p.markers) {
        seen.add(mm.id)
        const key = JSON.stringify([mm.view, mm.anchor, mm.zIndex])
        const existing = drawn.annotations.get(mm.id)
        if (existing && existing.key === key) {
            existing.ann.coordinate = new mk.Coordinate(mm.lat, mm.lon)
            continue
        }
        if (existing) m.removeAnnotation(existing.ann)
        const ann = new mk.Annotation(new mk.Coordinate(mm.lat, mm.lon), () => {
            const div = document.createElement("div")
            div.innerHTML = markerHTML(mm.view)
            div.setAttribute("aria-label", mm.label ?? "")
            if (mm.tappable) {
                div.style.cursor = "pointer"
                div.addEventListener("click", (e) => { e.stopPropagation(); onMarkerPress(mm.id) })
            }
            return div
        }, {
            // MapKit JS puts an annotation's bottom-centre on its coordinate; "center" shifts it down half its height.
            anchorOffset: new DOMPoint(0, mm.anchor === "bottom" ? 0 : heightOf(mm.view) / 2),
            calloutEnabled: false,
            enabled: !!mm.tappable,
            displayPriority: 1000,
        })
        if (mm.zIndex) ann.zIndex = mm.zIndex
        m.addAnnotation(ann)
        drawn.annotations.set(mm.id, { ann, key })
    }
    for (const [id, { ann }] of drawn.annotations) {
        if (!seen.has(id)) {
            m.removeAnnotation(ann)
            drawn.annotations.delete(id)
        }
    }
}

export default function AppleMapWeb({ ref, ...props }: Props) {
    const el = useRef<HTMLDivElement>(null)
    const map = useRef<any>(null)
    const drawn = useRef<Drawn>({ annotations: new Map(), overlays: [] })
    const userGesture = useRef(false)
    // Calls back to the app before the native web view has finished mounting
    // get their reply sent to a view that isn't registered yet ("Unable to
    // find DomWebView with tag") - hold them until the page has settled.
    const settled = useRef(false)
    useEffect(() => {
        const t = setTimeout(() => { settled.current = true }, 600)
        return () => clearTimeout(t)
    }, [])
    const latest = useRef(props)
    useEffect(() => { latest.current = props })

    useDOMImperativeHandle<AppleMapWebCamera>(ref as Ref<AppleMapWebCamera>, () => ({
        run: (raw) => {
            const cmd = raw as unknown as CameraCommand
            const mk = window.mapkit
            const m = map.current
            if (!mk || !m) return
            if (cmd.op === "easeTo") {
                const c = cmd.lon !== null && cmd.lat !== null ? { lat: cmd.lat, lon: cmd.lon } : { lat: m.center.latitude, lon: m.center.longitude }
                if (cmd.zoom !== null) m.setRegionAnimated(regionFor(mk, el.current, c, cmd.zoom), cmd.animated)
                else m.setCenterAnimated(new mk.Coordinate(c.lat, c.lon), cmd.animated)
                if (cmd.rotation != null) m.setRotationAnimated(cmd.rotation, cmd.animated)
            } else {
                m.padding = new mk.Padding(cmd.top, cmd.right, cmd.bottom, cmd.left)
                m.setRegionAnimated(regionOfBounds(mk, cmd.bounds), cmd.animated ?? false)
            }
        },
    }), [])

    // Create the map once.
    useEffect(() => {
        let cancelled = false
        loadMapKit(() => latest.current.getToken()).then((mk) => {
            if (cancelled || !el.current || map.current) return
            const p = latest.current
            const m = new mk.Map(el.current, {
                showsCompass: mk.FeatureVisibility.Hidden,
                showsMapTypeControl: false,
                showsZoomControl: false,
                showsUserLocationControl: false,
                isRotationEnabled: p.interactive,
                isScrollEnabled: p.interactive,
                isZoomEnabled: p.interactive,
                colorScheme: p.dark ? mk.Map.ColorSchemes.Dark : mk.Map.ColorSchemes.Light,
                padding: new mk.Padding(p.padding.top, p.padding.right, p.padding.bottom, p.padding.left),
            })
            m.region = p.bounds ? regionOfBounds(mk, p.bounds) : regionFor(mk, el.current, p.center, p.zoom)
            const gesture = () => { userGesture.current = true }
            m.addEventListener("scroll-start", gesture)
            m.addEventListener("zoom-start", gesture)
            m.addEventListener("region-change-end", () => {
                if (!settled.current) return
                const r = m.region
                const w = el.current?.clientWidth || 400
                const z = zoomForSpan(r.span.longitudeDelta, w)
                const c = r.center
                void latest.current.onRegion(
                    { lat: c.latitude, lon: c.longitude },
                    z,
                    [c.longitude - r.span.longitudeDelta / 2, c.latitude - r.span.latitudeDelta / 2, c.longitude + r.span.longitudeDelta / 2, c.latitude + r.span.latitudeDelta / 2],
                    userGesture.current,
                )
                userGesture.current = false
            })
            m.addEventListener("single-tap", () => { if (settled.current) void latest.current.onMapPress() })
            map.current = m
            draw(mk, m, latest.current, drawn.current, (id) => { void latest.current.onMarkerPress(id) })
            const ready = () => {
                if (!settled.current) { setTimeout(ready, 100); return }
                void latest.current.onReady()
                // Report where the map ended up once the app can hear it.
                const r = m.region
                const w = el.current?.clientWidth || 400
                const c = r.center
                void latest.current.onRegion(
                    { lat: c.latitude, lon: c.longitude },
                    zoomForSpan(r.span.longitudeDelta, w),
                    [c.longitude - r.span.longitudeDelta / 2, c.latitude - r.span.latitudeDelta / 2, c.longitude + r.span.longitudeDelta / 2, c.latitude + r.span.latitudeDelta / 2],
                    false,
                )
            }
            ready()
        }).catch(() => {})
        return () => {
            cancelled = true
            map.current?.destroy?.()
            map.current = null
        }
    }, [])

    const { lines, markers, dark } = props
    useEffect(() => {
        const mk = window.mapkit
        if (mk && map.current) draw(mk, map.current, latest.current, drawn.current, (id) => { void latest.current.onMarkerPress(id) })
    }, [lines, markers, dark])

    return <div ref={el} style={{ position: "fixed", inset: 0, margin: 0 }} />
}
