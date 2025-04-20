import { useEffect, useState, useRef } from "react";

type UserLocation = [number, number];

export function getUserLocation(): Promise<UserLocation> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            console.error("Geolocation is not supported by this browser.");
            return reject(new Error("Geolocation not supported"));
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;
                resolve([userLat, userLon]);
            },
            (error) => {
                reject(error); // Pass the error object
            }
        );
    });
}

interface UseUserLocation {
    location: UserLocation;
    loading: boolean;
    error: Error | null;
    locationFound: boolean;
}

export function useUserLocation(doNotAutoUpdate?: boolean): UseUserLocation {
    const [location, setLocation] = useState<UserLocation>([0, 0]);
    const [loading, setLoading] = useState<boolean>(true);
    const [found, setFound] = useState<boolean>(false)
    const [error, setError] = useState<Error | null>(null);
    const permissionDeniedRef = useRef(false); // Track if permission was denied

    useEffect(() => {
        const fetchLocation = async () => {
            if (permissionDeniedRef.current) return;

            try {
                const userLocation = await getUserLocation();
                setLocation(userLocation);
                setFound(true)
                setError(null);
            } catch (err) {
                const errorObj = err as GeolocationPositionError;
                // Only set permission denied once
                if (errorObj.code === errorObj.PERMISSION_DENIED) {
                    permissionDeniedRef.current = true;
                    setError(new Error("Location permission denied"));
                } else {
                    setError(errorObj as unknown as Error);
                }
                setFound(false)
            } finally {
                setLoading(false);
            }
        };

        fetchLocation();

        if (doNotAutoUpdate || permissionDeniedRef.current) return;

        let intervalId: NodeJS.Timeout | null = null;

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible" && !permissionDeniedRef.current) {
                intervalId = setInterval(fetchLocation, 5000);
            } else if (document.visibilityState === "hidden" && intervalId) {
                clearInterval(intervalId);
            }
        };

        handleVisibilityChange();
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            if (intervalId) clearInterval(intervalId);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [doNotAutoUpdate]);

    return { location, loading, error, locationFound: found };
}
