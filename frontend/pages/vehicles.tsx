import { useEffect } from "react";
import { useRouter } from "next/router";

/**
 * Moved to the Map tab: /map?mode=vehicles (keeping ?tripId=, which push
 * notifications and shared links use). next.config.ts redirects this on the
 * server; this covers hosts that serve the pages statically.
 */
export default function VehiclesRedirect() {
    const router = useRouter();
    useEffect(() => {
        if (!router.isReady) return;
        router.replace({ pathname: "/map", query: { ...router.query, mode: "vehicles" } });
    }, [router]);
    return null;
}
