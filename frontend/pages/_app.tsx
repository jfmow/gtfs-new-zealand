import NavBar from "@/components/nav";
import { checkStopSubscription, register } from "@/lib/notifications";
import { UrlProvider } from "@/lib/url-context";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { GeistSans } from "geist/font/sans";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/ui/theme-provider";


export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    register("/pwa/sw.js", {}).then(() => {
      checkStopSubscription("")
    })

  }, [])
  return <>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <main className={cn(GeistSans.className, " flex flex-col min-h-[100svh] bg-background")}>
        <UrlProvider>
          <NavBar />
          <Toaster richColors position={"top-center"} />
          <div className="flex flex-col flex-grow">
            <Component {...pageProps} />
          </div>
        </UrlProvider>
      </main>
    </ThemeProvider>
  </>;
}
