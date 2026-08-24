import Favorites, { AddToFavorites } from "@/components/stops/favourites";
import NavigateToStop from "@/components/stops/navigate-to-stop";
import SearchForStop from "@/components/stops/search";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { useQueryParams } from "@/lib/url-params";
import { MessageCircleWarningIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Header } from "@/components/nav";
import { NearbyStops } from "@/components/home/nearby-stops";

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

      {selectedStop === "" ? (
        <div className="flex flex-col h-[calc(100svh-4rem)] overflow-hidden md:h-auto md:overflow-visible">
          <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4 shrink-0">
            <div className="flex gap-2 items-center w-full">
              <SearchForStop />
            </div>
            <div className="mt-3">
              <Favorites />
            </div>
          </div>

          <div className="flex flex-col flex-grow min-h-0 px-4 pb-4 max-w-[1400px] mx-auto w-full gap-4">
            <div className="shrink-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                <h2 className="text-xs font-display uppercase tracking-wide text-muted-foreground">Near you</h2>
              </div>
              <NearbyStops />
            </div>

            <div className="flex flex-col flex-grow min-h-0 md:min-h-[400px]">
              <Suspense fallback={null}>
                <StopsMap buttonPosition="bottom" />
              </Suspense>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 pb-4">
            <div className="flex gap-2 items-center w-full">
              <SearchForStop />
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
            </div>
          </div>

          <Suspense fallback={null}>
            <Services filterDate={selectedDate} stopName={selectedStop} />
          </Suspense>
        </>
      )}
    </>
  );
}
