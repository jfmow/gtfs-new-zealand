import Footer from "@/components/footer";
import NavBar from "@/components/nav";
import { ThemeProvider } from "@/components/theme";
import { checkStopSubscription, register } from "@/lib/notifications";
import { UrlProvider } from "@/lib/url-context";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";
import { Toaster } from "sonner";

//Post hog
import posthog from 'posthog-js'
import { Router } from "next/router";
import { PostHogProvider } from 'posthog-js/react'


export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    register("/sw.js", {}).then(() => {
      checkStopSubscription("")
    })
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
      // Enable debug mode in development
      loaded: (posthog) => {
        if (process.env.NODE_ENV === 'development') posthog.debug()
      }
    })

    const handleRouteChange = () => posthog?.capture('$pageview')

    Router.events.on('routeChangeComplete', handleRouteChange);

    return () => {
      Router.events.off('routeChangeComplete', handleRouteChange);
    }
  }, [])
  return <>
    <PostHogProvider client={posthog}>
      <ThemeProvider>
        <UrlProvider>
          <NavBar />
          <Toaster richColors position={"top-center"} />
          <Component {...pageProps} />
          <Footer />
        </UrlProvider>
      </ThemeProvider>
    </PostHogProvider>
  </>;
}
