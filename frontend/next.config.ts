import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: false,
  devIndicators: false,
  // Shown at the foot of Settings.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  // /stops and /vehicles became the Map tab's two modes. Query strings pass
  // through, so push notifications' /vehicles?tripId=... still open the tracker.
  // Universal links: iOS fetches this (no file extension) and expects JSON.
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/stops", destination: "/map?mode=stops", permanent: false },
      { source: "/vehicles", destination: "/map?mode=vehicles", permanent: false },
    ];
  },
};

export default nextConfig;

/**
 * 
 * webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      Object.assign(config.resolve.alias, {
        "react/jsx-runtime.js": "preact/compat/jsx-runtime",
        react: "preact/compat",
        "react-dom/test-utils": "preact/test-utils",
        "react-dom": "preact/compat",
      });
    }
    return config;
  },
 */