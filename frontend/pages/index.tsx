import Favorites, { AddToFavorites } from "@/components/stops/favourites";
import SearchForStop from "@/components/stops/search";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { useQueryParams } from "@/lib/url-params";
import { MessageCircleWarningIcon, StarIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Header } from "@/components/nav";
import { useIsMobile } from "@/lib/utils";

const Services = lazy(() => import("@/components/services"))
const StopsMap = lazy(() => import("./stops").then(module => ({ default: module.StopsMap })))

export default function Home() {
  const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s"] } }); // Get the 's' parameter and if it's found
  const [selectedStop, setSelectedStop] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>()
  const isMobile = useIsMobile();

  useEffect(() => {
    setSelectedStop(selected_stop.value);
  }, [selected_stop]);

  return (
    <>
      <Header title="Train, Bus, Ferry - Find you next journey" />
      <div className="mx-auto w-full max-w-[1400px] flex flex-col px-4 sm:px-6 py-6 gap-4">
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 items-center w-full">
            <SearchForStop />
            {selectedStop !== "" ? (
              <>
                <DatePicker onChange={(date) => setSelectedDate(date)} />
                <Button aria-label="Travel alerts" disabled={selectedStop === ""} variant={"outline"} size="icon" className="rounded-lg" onClick={() => { window.location.href = `/alerts?s=${selectedStop}` }}>
                  <MessageCircleWarningIcon className="w-4 h-4" />
                </Button>
                <AddToFavorites stopName={selectedStop} />
              </>
            ) : null}
          </div>
        </div>
        {!isMobile ? (
          <Accordion value={selected_stop.found ? undefined : selectedStop === "" ? "item-1" : ""} type="single" collapsible className="border rounded-lg px-4">
            <AccordionItem value="item-1" className="border-0">
              <AccordionTrigger className="!no-underline hover:no-underline py-3">
                <div className="flex items-center gap-2">
                  <StarIcon className="text-yellow-500 fill-yellow-500 w-4 h-4" />
                  <h4 className="text-sm font-semibold">
                    Favorites
                  </h4>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <Favorites />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>

      {selectedStop === "" ? (
        <>
          <div className="w-full px-4 pb-4 max-w-[1400px] mx-auto w-full sm:hidden">
            <Favorites grid />
          </div>
          <div className="flex flex-col flex-grow px-4 pb-4 h-full max-w-[1400px] mx-auto w-full">
            <Suspense fallback=" ">
              <StopsMap buttonPosition="bottom" />
            </Suspense>
          </div>
        </>
      ) : (
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
          <Suspense fallback="">
            <Services filterDate={selectedDate} stopName={selectedStop} />
          </Suspense>
        </div>
      )}
    </>
  );
}
