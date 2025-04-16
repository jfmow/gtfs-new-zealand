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


export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    register("/pwa/sw.js", {}).then(() => {
      checkStopSubscription("")
    })

  }, [])
  return <>
    <main className={GeistSans.className}>
      <ThemeProvider>
        <UrlProvider>
          <NavBar />
          <Toaster richColors position={"top-center"} />
          <Component {...pageProps} />
          <Footer />
        </UrlProvider>
      </ThemeProvider>
    </main>
  </>;
}
