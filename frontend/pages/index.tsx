import Services from "@/components/services";
import Favorites, { AddToFavorites } from "@/components/stops/favourites";
import SearchForStop from "@/components/stops/search";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { useQueryParams } from "@/lib/url-params";
import { MessageCircleWarningIcon, StarIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Header } from "@/components/nav";
import { useIsMobile } from "@/lib/utils";

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
      <div className="mx-auto w-full max-w-[1400px] flex flex-col p-4">
        <div className="grid items-center gap-2">
          <div className="flex gap-2 items-center w-full">
            <SearchForStop />
            {selectedStop !== "" ? (
              <DatePicker onChange={(date) => setSelectedDate(date)} />
            ) : null}
            <Button aria-label="Travel alerts" disabled={selectedStop === ""} variant={"outline"} onClick={() => { window.location.href = `/alerts?s=${selectedStop}` }}>
              <MessageCircleWarningIcon />
            </Button>
            <AddToFavorites stopName={selectedStop} />
          </div>
        </div>
        {!isMobile ? (
          <Accordion value={selected_stop.found ? undefined : selectedStop === "" ? "item-1" : ""} type="single" collapsible>
            <AccordionItem value="item-1">
              <AccordionTrigger className="!no-underline">
                <div className="flex items-center gap-1">
                  <StarIcon className="text-yellow-500 fill-yellow-500 w-4 h-4" />
                  <h4 className="scroll-m-20 text-sm font-semibold tracking-tight">
                    Favorites
                  </h4>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Favorites />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>
      <Services filterDate={selectedDate} stopName={selectedStop} />
    </>
  );
}