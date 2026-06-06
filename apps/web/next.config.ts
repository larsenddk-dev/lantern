import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  // Static export: disable image optimisation (requires server)
  images: { unoptimized: true },
  // Trailing slash so Tauri can load index.html from file:// paths
  trailingSlash: true,
  // Pin the workspace root so Turbopack doesn't infer it from a stray
  // lockfile higher up the tree (e.g. ~/package-lock.json).
  turbopack: {
    root: path.resolve(import.meta.dirname, "..", ".."),
  },
};

export default nextConfig;
