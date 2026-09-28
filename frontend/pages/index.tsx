import SearchForStop from "@/components/stops/search";
import SavedStopsSection from "@/components/stops/favourites";
import { StopBoardPage } from "@/components/stops/stop-board";
import { Header } from "@/components/nav";
import { NearbySection } from "@/components/home/nearby-stops";
import { SavedTripsSection } from "@/components/home/saved-trips-section";
import { SavedPlacesRow } from "@/components/places/places";
import { useUrlOverlay } from "@/lib/url-overlay";
import { useOnlineStatus } from "@/lib/utils";
import { WifiOff } from "lucide-react";
import { FirstVisitCard } from "@/components/home/first-visit-card";

/**
 * The Schedule tab - the iOS Home tab: stop search, then Places, Saved
 * stops, Saved trips and Nearby (two columns on wide screens). A stop's
 * board (`?s=`) takes over the tab, with a back button to here.
 */
export default function Home() {
  const board = useUrlOverlay("s");
  const online = useOnlineStatus();

  if (board.value !== "") {
    return (
      <>
        <Header title={`${board.value} — departures`} />
        <StopBoardPage stopQuery={board.value} title={board.value} backLabel="Schedule" onClose={board.close} />
      </>
    );
  }

  return (
    <>
      <Header title="Train, Bus, Ferry — Find your next journey" />
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-4 pb-8">
        <SearchForStop />

        <FirstVisitCard />

        {!online && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5" /> You&apos;re offline - departures will update when you&apos;re back online.
          </p>
        )}

        {/* Your things on the left, what's around you on the right. */}
        <div className="grid gap-7 lg:grid-cols-2 lg:gap-8">
          <div className="flex min-w-0 flex-col gap-7">
            <SavedPlacesRow />
            <SavedStopsSection />
            <SavedTripsSection />
          </div>
          <NearbySection className="min-w-0" />
        </div>
      </div>
    </>
  );
}
