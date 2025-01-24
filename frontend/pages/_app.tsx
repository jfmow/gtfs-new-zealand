import { register } from "@/lib/notifications";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    register("/sw.js", {})
  }, [])
  return <Component {...pageProps} />;
}
