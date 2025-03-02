import { useEffect, useState } from "react";

// Define the return type for the location
type UserLocation = [number, number]; // Tuple type for latitude and longitude

function getUserLocation(): Promise<UserLocation> {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            console.error("Geolocation is not supported by this browser.");
            return resolve([0, 0]); // Return [0, 0] if geolocation is not supported
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;
                resolve([userLat, userLon]);
            },
            (error) => {
                console.error("Error getting location:", error);
                resolve([0, 0]); // Return [0, 0] if there's an error
            }
        );
    });
}


interface UseUserLocation {
    location: UserLocation;  // The user's location as [latitude, longitude]
    loading: boolean;        // Loading state
    error: Error | null;    // Error state
    hasPermission: boolean | null; // Permission state
}

export function useUserLocation(): UseUserLocation {
    const [location, setLocation] = useState<UserLocation>([0, 0]); // Initialize location state
    const [loading, setLoading] = useState<boolean>(true); // Loading state for the location
    const [error, setError] = useState<Error | null>(null); // Error state for the location
    const [hasPermission, setHasPermission] = useState<boolean | null>(null); // Track permission status

    useEffect(() => {
        const checkPermissionAndFetch = async () => {
            try {
                const permissionStatus = await navigator.permissions.query({ name: "geolocation" });

                if (permissionStatus.state === "granted") {
                    setHasPermission(true);
                    setLoading(true);

                    const fetchLocation = async () => {
                        try {
                            const userLocation = await getUserLocation();
                            setLocation(userLocation); // Update state with fetched location
                            setError(null); // Reset error if successful
                        } catch (err) {
                            setError(err as Error); // Handle any errors
                        } finally {
                            setLoading(false); // Set loading to false after fetching location
                        }
                    };

                    fetchLocation(); // Fetch immediately
                    const intervalId = setInterval(fetchLocation, 10000); // Fetch location every 10 seconds

                    return () => clearInterval(intervalId); // Cleanup interval on unmount
                } else {
                    setHasPermission(false);
                    setLoading(false);
                }
            } catch (err) {
                setError(err as Error);
                setLoading(false);
            }
        };

        checkPermissionAndFetch();
    }, []); // Runs once on mount

    return { location, loading, error, hasPermission }; // Return states
}
