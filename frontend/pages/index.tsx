import NavBar from "@/components/nav";
import Services from "@/components/services";
import StopNotifications from "@/components/services/notifications";
import SearchForStop from "@/components/stops/search";
import TrainStation from "@/components/stops/train stations";
import { Button } from "@/components/ui/button";
import { BellDot } from "lucide-react";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function Home() {
  const { found, value } = useAQueryParam("s"); // Get the 's' parameter and if it's found
  const [selectedStop, setSelectedStop] = useState<string>("");

  useEffect(() => {
    if (found) {
      setSelectedStop(value);
    }
  }, [found, value]);

  return (
    <>
      <Header />
      <NavBar />
      <div className="w-full">
        <div className="mx-auto max-w-[1400px] flex flex-col p-4">
          <div className="grid sm:grid-cols-2 gap-2">
            <TrainStation onChange={(v) => {
              setSelectedStop(v)
              window.history.pushState({}, '', `/?s=${v}`)
            }} />
            <SearchForStop url="/?s=" />
          </div>
          <div className="mt-4 flex items-center justify-between flex-wrap gap-5">
            <h4 className="text-center scroll-m-20 text-xl font-semibold tracking-tight">
              {selectedStop}
            </h4>
            <div className="flex items-center gap-2">
              <Button disabled={selectedStop === ""} variant={"secondary"} onClick={() => { window.location.href = `/alerts?r=${selectedStop}` }}>
                View alerts for stop
              </Button>
              <StopNotifications stopName={selectedStop}>
                <Button variant={"outline"}>
                  <BellDot />
                </Button>
              </StopNotifications>
            </div>
          </div>
          <Services stopName={selectedStop} />
        </div>
      </div>
    </>
  );
}

export function useAQueryParam(id: string): { value: string; found: boolean } {
  const [value, setValue] = useState<string>(""); // State for the query param 's'
  const [found, setFound] = useState<boolean>(false); // State to track if 's' was found
  const router = useRouter(); // Use the router hook to listen for URL changes

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search); // Get query parameters from the URL
    const paramValue = urlParams.get(id); // Extract the 's' parameter

    if (paramValue !== null) {
      setValue(paramValue); // Set the value if 's' is found
      setFound(true); // Mark as found
    } else {
      setValue(""); // Set value to empty string if not found
      setFound(false); // Mark as not found
    }
  }, [router.query.s, id]); // Run when the query parameter `s` changes

  return { value, found };
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