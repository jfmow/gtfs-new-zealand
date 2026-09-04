import NavBar from "@/components/nav";
import { ResumeJourneyPrompt } from "@/components/journey/resume-journey-prompt";
import { checkStopSubscription, register } from "@/lib/notifications";
import { UrlProvider } from "@/lib/url-context";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Toaster } from "sonner";
import { displayFont, bodyFont, monoFont } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/ui/theme-provider";

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()
  const [transitioning, setTransitioning] = useState(false)

  useEffect(() => {
    register("/pwa/sw.js", {}).then(() => {
      checkStopSubscription("")
    })

  }, [])

  useEffect(() => {
    const handleStart = (url: string) => {
      // Query-only changes (e.g. selecting a vehicle) aren't page transitions.
      if (url.split("?")[0] !== router.pathname) setTransitioning(true)
    }
    const handleDone = () => setTransitioning(false)

    router.events.on("routeChangeStart", handleStart)
    router.events.on("routeChangeComplete", handleDone)
    router.events.on("routeChangeError", handleDone)
    return () => {
      router.events.off("routeChangeStart", handleStart)
      router.events.off("routeChangeComplete", handleDone)
      router.events.off("routeChangeError", handleDone)
    }
  }, [router])

  return <>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <main className={cn(displayFont.variable, bodyFont.variable, monoFont.variable, bodyFont.className, "flex flex-col min-h-[100svh] bg-background")}>
        <UrlProvider>
          <NavBar />
          <ResumeJourneyPrompt />
          <Toaster richColors position={"top-center"} />
          <div
            className={cn(
              "flex flex-col flex-grow transition-opacity duration-150 ease-out motion-reduce:transition-none",
              transitioning ? "opacity-0" : "opacity-100"
            )}
          >
            <Component {...pageProps} />
          </div>
        </UrlProvider>
      </main>
    </ThemeProvider>
  </>;
}
