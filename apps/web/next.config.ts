import type { NextConfig } from "next";
import path from "path";
import { readFileSync } from "fs";

// Expose the version from package.json to client code so the sidebar
// footer can render "Lantern v<actual>" without us hardcoding it.
const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8"),
);

const nextConfig: NextConfig = {
  output: "export",
  // Static export: disable image optimisation (requires server)
  images: { unoptimized: true },
  // Trailing slash so Tauri can load index.html from file:// paths
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_LANTERN_VERSION: pkg.version,
  },
  // Pin the workspace root so Turbopack doesn't infer it from a stray
  // lockfile higher up the tree (e.g. ~/package-lock.json).
  turbopack: {
    root: path.resolve(import.meta.dirname, "..", ".."),
  },
};

export default nextConfig;
