import Services from "@/components/services";
import Favorites, { AddToFavorites } from "@/components/stops/favourites";
import SearchForStop from "@/components/stops/search";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import HelpMenu from "@/components/ui/help-menu";
import { useQueryParams } from "@/lib/url-params";
import { MessageCircleWarningIcon, StarIcon } from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export default function Home() {
  const { selected_stop } = useQueryParams({ selected_stop: { type: "string", default: "", keys: ["s"] } }); // Get the 's' parameter and if it's found
  const [selectedStop, setSelectedStop] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>()

  useEffect(() => {
    if (selected_stop.found) {
      setSelectedStop(selected_stop.value);
    }
  }, [selected_stop]);

  return (
    <>
      <Header />
      <div className="w-full">
        <div className="mx-auto max-w-[1400px] flex flex-col p-4">
          <div className="grid items-center gap-2">
            <div className="flex gap-2 items-center w-full">
              <SearchForStop />
              {selectedStop !== "" ? (
                <DatePicker onChange={(date) => setSelectedDate(date)} />
              ) : null}
              <Button disabled={selectedStop === ""} variant={"outline"} onClick={() => { window.location.href = `/alerts?s=${selectedStop}` }}>
                <MessageCircleWarningIcon />
              </Button>
              <AddToFavorites stopName={selectedStop} />
            </div>
            <div className="flex items-center flex-wrap gap-2 hidden">
              <div className="flex items-center gap-2">
                <Button disabled={selectedStop === ""} variant={"outline"} onClick={() => { window.location.href = `/alerts?s=${selectedStop}` }}>
                  <MessageCircleWarningIcon />
                </Button>
                <HelpMenu title="Services">
                  The following color indicators represent the status of arrival times:
                  <div className="p-2 flex flex-col items-center justify-start gap-4">
                    <div className="flex items-center gap-1 text-orange-500">
                      <div className="w-6 h-6 bg-orange-100 border border-orange-200 rounded-md" />
                      Early
                    </div>
                    <div className="flex items-center gap-1 text-green-500">
                      <div className="w-6 h-6 bg-green-100 border border-green-200 rounded-md" />
                      On Time
                    </div>
                    <div className="flex items-center gap-1 text-red-500">
                      <div className="w-6 h-6 bg-red-100 border border-red-200 rounded-md" />
                      Delayed
                    </div>
                  </div>
                </HelpMenu>

              </div>
            </div>
          </div>
          <Accordion value={selected_stop.found ? undefined : selectedStop === "" ? "item-1" : ""} type="single" collapsible>
            <AccordionItem value="item-1">
              <AccordionTrigger>
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
          <div className="my-2" />
          <Services filterDate={selectedDate} stopName={selectedStop} />
        </div>
      </div>
    </>
  );
}




function Header() {
  return (
    <Head>
      <title>Train, Bus, Ferry</title>

      <link rel="manifest" href="manifest.json" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="application-name" content="Trains" />
      <meta name="apple-mobile-web-app-title" content="Trains" />
      <meta name="theme-color" content="#ffffff" />
      <meta name="msapplication-navbutton-color" content="#ffffff" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="msapplication-starturl" content="/" />
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
      <link rel='icon' type='image/png' href={`/Favicon.png`} />
      <link rel="apple-touch-icon" href={`/Favicon.png`} />
      <link rel="shortcut icon" href={`/Favicon.png`} />

      <meta name="description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
      <meta name="keywords" content="at, auckland, auckland transport, transport, trains, bus, travel, car, fly, tracks, train tracks, track train, ferry, at mobile"></meta>
      <link rel="canonical" href="https://trains.suddsy.dev/"></link>
      <meta property="og:title" content="Train Bus Ferry - Track, predict and follow Auckland's trains, buses and ferry's." />
      <meta property="og:url" content="https://trains.suddsy.dev/" />
      <meta property="og:description" content="Auckland transports trains, buses and ferry's all in one easy to navigate place. Track, predict and prepare your journey." />
      <meta property="og:image" content="https://trains.suddsy.dev/rounded-icon.png" />
    </Head>
  )
}