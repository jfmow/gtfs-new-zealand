import Favorites, { AddToFavorites } from "@/components/stops/favourites";
import NavigateToStop from "@/components/stops/navigate-to-stop";
import SearchForStop from "@/components/stops/search";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { useQueryParams } from "@/lib/url-params";
import { MessageCircleWarningIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Header } from "@/components/nav";

const Services = lazy(() => import("@/components/services"))
const StopsMap = lazy(() => import("./stops").then(module => ({ default: module.StopsMap })))

export default function Home() {
  const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s"] } });
  const [selectedStop, setSelectedStop] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>()

  useEffect(() => {
    setSelectedStop(selected_stop.value);
  }, [selected_stop]);

  return (
    <>
      <Header title="Train, Bus, Ferry — Find your next journey" />

      <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4">
        {/* Search bar row */}
        <div className="flex gap-2 items-center w-full">
          <SearchForStop />
          {selectedStop !== "" && (
            <>
              <DatePicker onChange={(date) => setSelectedDate(date)} />
              <NavigateToStop stopName={selectedStop} />
              <Button
                aria-label="Travel alerts"
                variant="outline"
                size="icon"
                className="flex-shrink-0"
                onClick={() => { window.location.href = `/alerts?s=${selectedStop}` }}
              >
                <MessageCircleWarningIcon className="w-4 h-4" />
              </Button>
              <AddToFavorites stopName={selectedStop} />
            </>
          )}
        </div>

        {/* Favourites — always visible when no stop selected */}
        {selectedStop === "" && (
          <div className="mt-3">
            <Favorites />
          </div>
        )}
      </div>

      {selectedStop === "" ? (
        <div className="flex flex-col flex-grow px-4 pb-4 max-w-[1400px] mx-auto w-full">
          <Suspense fallback={null}>
            <StopsMap buttonPosition="bottom" />
          </Suspense>
        </div>
      ) : (
        <Suspense fallback={null}>
          <Services filterDate={selectedDate} stopName={selectedStop} />
        </Suspense>
      )}
    </>
  );
}
