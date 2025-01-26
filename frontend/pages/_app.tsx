import { checkStopSubscription, register } from "@/lib/notifications";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";
import { Toaster } from "sonner";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    register("/sw.js", {}).then(() => {
      checkStopSubscription("")
    })
  }, [])
  return <>
    <Toaster richColors position={"top-center"} />
    <Component {...pageProps} />
  </>;
}
