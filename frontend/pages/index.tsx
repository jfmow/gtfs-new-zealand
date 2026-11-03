import SearchForStop from "@/components/stops/search";
import SavedStopsSection from "@/components/stops/favourites";
import { StopBoardPage } from "@/components/stops/stop-board";
import { Header } from "@/components/nav";
import { NearbySection } from "@/components/home/nearby-stops";
import { HomeGreeting, HomeLauncher } from "@/components/home/launcher";
import { useUrlOverlay } from "@/lib/url-overlay";
import { useOnlineStatus } from "@/lib/utils";
import { WifiOff } from "lucide-react";
import { FirstVisitCard } from "@/components/home/first-visit-card";

/**
 * The Schedule tab - the iOS Home tab ("Boards", 2026-11-03): stop search,
 * a greeting, a row of round shortcuts (find my vehicle, your places and
 * trips), then your stops and the stops near you as small departure boards
 * (two to a row on wide screens). A stop's board (`?s=`) takes over the
 * tab, with a back button to here.
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
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 pb-8">
        <SearchForStop />

        <HomeGreeting />
        <HomeLauncher />

        <FirstVisitCard />

        {!online && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
            <WifiOff className="h-3.5 w-3.5" /> You&apos;re offline - departures will update when you&apos;re back online.
          </p>
        )}

        <SavedStopsSection />
        <NearbySection />
      </div>
    </>
  );
}
