import { Html, Head, Main, NextScript } from "next/document";
import { displayFont, bodyFont, monoFont } from "@/lib/fonts";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Warm the connections the MapLibre basemap needs before the map JS
            even loads - saves a DNS+TLS round trip off the first tile fetch. */}
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://tiles.basemaps.cartocdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossOrigin="" />
        <link rel="preconnect" href="https://trainapi.suddsy.dev" crossOrigin="" />
        {/* Fetch the (light) style JSON during HTML parse so MapLibre gets it
            from cache. Dark-mode users take one uncached fetch. */}
        <link
          rel="preload"
          as="fetch"
          crossOrigin="anonymous"
          href="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        />
      </Head>
      <body className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} ${bodyFont.className} bg-background`}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
