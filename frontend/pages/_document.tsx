import { Html, Head, Main, NextScript } from "next/document";
import { GeistSans } from "geist/font/sans";
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className={`${GeistSans.className} bg-background`}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
