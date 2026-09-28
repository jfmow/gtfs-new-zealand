import { useEffect } from "react";
import { useRouter } from "next/router";

/**
 * Moved to the Map tab: /map?mode=stops. next.config.ts redirects this on
 * the server; this covers hosts that serve the pages statically.
 */
export default function StopsRedirect() {
    const router = useRouter();
    useEffect(() => {
        if (!router.isReady) return;
        router.replace({ pathname: "/map", query: { ...router.query, mode: "stops" } });
    }, [router]);
    return null;
}
