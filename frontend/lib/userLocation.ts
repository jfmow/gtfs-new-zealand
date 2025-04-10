import { useEffect, useState } from "react";

// Define the return type for the location
type UserLocation = [number, number]; // Tuple type for latitude and longitude

export function getUserLocation(): Promise<UserLocation> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            console.error("Geolocation is not supported by this browser.");
            return reject([0, 0]); // Return [0, 0] if geolocation is not supported
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;
                resolve([userLat, userLon]);
            },
            (error) => {
                console.error("Error getting location:", error);
                reject([0, 0]); // Return [0, 0] if there's an error
            }
        );
    });
}


interface UseUserLocation {
    location: UserLocation;  // The user's location as [latitude, longitude]
    loading: boolean;        // Loading state
    error: Error | null;    // Error state
}

export function useUserLocation(doNotAutoUpdate?: boolean): UseUserLocation {
    const [location, setLocation] = useState<UserLocation>([0, 0]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        const fetchLocation = async () => {
            try {
                const userLocation = await getUserLocation();
                setLocation(userLocation);
                setError(null); // Clear previous errors if successful
            } catch (err) {
                setError(err as Error);
            } finally {
            }
        };

        // Fetch immediately and then every 3 seconds
        fetchLocation().then(() => setLoading(false));
        if (doNotAutoUpdate) return; // If doNotAutoUpdate is true, skip the interval
        let intervalId: NodeJS.Timeout | null

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                intervalId = setInterval(fetchLocation, 3000);
            } else if (document.visibilityState === "hidden") {
                if (intervalId) {
                    clearInterval(intervalId);
                }
            }
        };
        handleVisibilityChange()
        document.addEventListener("visibilitychange", handleVisibilityChange);

        // Cleanup on unmount, visibility change, or dependencies update
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [doNotAutoUpdate]);

    return { location, loading, error };
}

