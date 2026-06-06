import type { MetadataRoute } from "next";

// Required for Next static export (output: 'export') so the manifest is emitted
// as a static file rather than a server route.
export const dynamic = "force-static";

// PWA manifest so Lantern can be installed from the browser as well as via the
// Tauri desktop build.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lantern — self-hosted AI workspace",
    short_name: "Lantern",
    description: "Your own local-first AI workspace. Carry your own light.",
    start_url: "/chat",
    display: "standalone",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    icons: [
      { src: "/lantern-logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "256x256", type: "image/png", purpose: "any" },
    ],
  };
}
