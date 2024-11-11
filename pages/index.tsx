import NavBar from "@/components/nav";
import Services from "@/components/services";
import SearchForStop from "@/components/stops/search";
import TrainStation from "@/components/stops/train stations";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Home() {
  const { found, value } = useStopQueryParam(); // Get the 's' parameter and if it's found
  const [selectedStop, setSelectedStop] = useState<string>("");

  useEffect(() => {
    if (found) {
      setSelectedStop(value);
    }
  }, [found, value]);

  return (
    <>
      <NavBar />
      <div className="w-full">
        <div className="mx-auto max-w-[1400px] flex flex-col p-4">
          <div className="grid sm:grid-cols-2 gap-2">
            <TrainStation onChange={(v) => {
              setSelectedStop(v)
              window.history.pushState({}, '', `/?s=${v}`)
            }} />
            <SearchForStop />
          </div>
          <h4 className="mt-4 text-center scroll-m-20 text-xl font-semibold tracking-tight">
            {selectedStop}
          </h4>
          <Services stopName={selectedStop} />
        </div>
      </div>
    </>
  );
}

export function useStopQueryParam(): { value: string; found: boolean } {
  const [value, setValue] = useState<string>(""); // State for the query param 's'
  const [found, setFound] = useState<boolean>(false); // State to track if 's' was found
  const router = useRouter(); // Use the router hook to listen for URL changes

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search); // Get query parameters from the URL
    const paramValue = urlParams.get('s'); // Extract the 's' parameter

    if (paramValue !== null) {
      setValue(paramValue); // Set the value if 's' is found
      setFound(true); // Mark as found
    } else {
      setValue(""); // Set value to empty string if not found
      setFound(false); // Mark as not found
    }
  }, [router.query.s]); // Run when the query parameter `s` changes

  return { value, found };
}

