import type { MetadataRoute } from "next";

// Next.js auto-serves this at /manifest.webmanifest and injects the
// <link rel="manifest"> tag — nothing to wire up in layout.tsx. Icon
// source is the Marble Grand Prix checkered-flag mark (app/icon.svg),
// rasterized to PNG (public/icons/*) on the navy tile since manifest icons
// need broad OS/launcher support that raw SVG doesn't reliably get on Android.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Marble Grand Prix",
    short_name: "Marble GP",
    description: "Predict race and competition winners, join community pools, and call it before your group chat.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
