import { Html, Head, Main, NextScript } from "next/document";
import { displayFont, bodyFont, monoFont } from "@/lib/fonts";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Warm the connections the map needs before its JS even loads. */}
        <link rel="preconnect" href="https://cdn.apple-mapkit.com" crossOrigin="" />
        <link rel="preconnect" href="https://trainapi.suddsy.dev" crossOrigin="" />
      </Head>
      <body className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} ${bodyFont.className} bg-background`}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
