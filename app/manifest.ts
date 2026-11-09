import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/brand";

/** The page colour token in app/globals.css (--paper), also the browser theme colour in app/layout.tsx. */
const PAPER = "#f4f4f2";

/**
 * The web app manifest. Installed on Android, LookLook appears in the share
 * sheet: a shared link or screenshot is posted to /api/share, which keeps a
 * screenshot for a few minutes and sends the browser on to /check, where the
 * check starts by itself.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/check",
    scope: "/",
    display: "standalone",
    background_color: PAPER,
    theme_color: PAPER,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    share_target: {
      action: "/api/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "file", accept: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/*"] }],
      },
    },
  };
}
