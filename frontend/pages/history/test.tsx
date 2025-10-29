import { useEffect, useState } from "react";
import Head from "next/head";

interface Trip {
    TripID: string;
    RouteID: string;
    ScheduleRelationship: string;
    Timestamp: number;
}

interface ApiResponse {
    status: string;
    data: {
        page: number;
        page_size: number;
        total_count: number;
        total_pages: number;
        trips: Trip[];
    };
}

export default function HistoryPage() {
    const [trips, setTrips] = useState<Trip[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function fetchTrips(pageNumber: number) {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`http://localhost:8090/at/hs?page=${pageNumber}&size=10`);
            if (!res.ok) throw new Error(`Failed to fetch trips (${res.status})`);
            const data: ApiResponse = await res.json();

            setTrips(data.data.trips);
            setPage(data.data.page);
            setTotalPages(data.data.total_pages);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchTrips(page);
    }, [page]);

    function nextPage() {
        if (page < totalPages) setPage(page + 1);
    }

    function prevPage() {
        if (page > 1) setPage(page - 1);
    }

    return (
        <>
            <Head>
                <title>Recent Trips | History</title>
            </Head>

            <main className="min-h-screen bg-gray-50 p-6">
                <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow p-6">
                    <h1 className="text-2xl font-semibold mb-4">Recent Trips</h1>

                    {loading && <p className="text-gray-600">Loading trips...</p>}
                    {error && <p className="text-red-500">Error: {error}</p>}

                    {!loading && !error && trips.length === 0 && (
                        <p className="text-gray-500">No trips found.</p>
                    )}

                    {!loading && trips.length > 0 && (
                        <>
                            <table className="w-full border border-gray-200 rounded-lg text-sm">
                                <thead className="bg-gray-100">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Trip ID</th>
                                        <th className="px-3 py-2 text-left">Route ID</th>
                                        <th className="px-3 py-2 text-left">Relationship</th>
                                        <th className="px-3 py-2 text-left">Timestamp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trips.map((trip) => (
                                        <tr key={trip.TripID} className="border-t hover:bg-gray-50">
                                            <td className="px-3 py-2 font-mono">{trip.TripID}</td>
                                            <td className="px-3 py-2">{trip.RouteID}</td>
                                            <td className="px-3 py-2">{trip.ScheduleRelationship}</td>
                                            <td className="px-3 py-2">
                                                {new Date(trip.Timestamp * 1000).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            <div className="flex justify-between items-center mt-6">
                                <button
                                    onClick={prevPage}
                                    disabled={page <= 1}
                                    className={`px-4 py-2 rounded-lg border ${page <= 1
                                        ? "text-gray-400 border-gray-200"
                                        : "text-blue-600 border-blue-300 hover:bg-blue-50"
                                        }`}
                                >
                                    ← Prev
                                </button>

                                <span className="text-gray-600">
                                    Page {page} of {totalPages}
                                </span>

                                <button
                                    onClick={nextPage}
                                    disabled={page >= totalPages}
                                    className={`px-4 py-2 rounded-lg border ${page >= totalPages
                                        ? "text-gray-400 border-gray-200"
                                        : "text-blue-600 border-blue-300 hover:bg-blue-50"
                                        }`}
                                >
                                    Next →
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </main>
        </>
    );
}
