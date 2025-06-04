import Footer from "@/components/footer";
import NavBar from "@/components/nav";
import { ThemeProvider } from "@/components/theme";
import { checkStopSubscription, register } from "@/lib/notifications";
import { UrlProvider } from "@/lib/url-context";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { GeistSans } from "geist/font/sans";
import { cn } from "@/lib/utils";


export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    register("/pwa/sw.js", {}).then(() => {
      checkStopSubscription("")
    })

  }, [])
  return <>
    <main className={cn(GeistSans.className, "overflow-x-hidden flex flex-col min-h-[100svh] bg-background")}>
      <ThemeProvider>
        <UrlProvider>
          <NavBar />
          <Toaster richColors position={"top-center"} />
          <div className="h-full w-full flex-grow">
            <Component {...pageProps} />
          </div>
          <Footer />
        </UrlProvider>
      </ThemeProvider>
    </main>
  </>;
}
