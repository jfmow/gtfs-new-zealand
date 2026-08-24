import { Html, Head, Main, NextScript } from "next/document";
import { displayFont, bodyFont, monoFont } from "@/lib/fonts";

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} ${bodyFont.className} bg-background`}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
