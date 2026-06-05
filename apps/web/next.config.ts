import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Static export: disable image optimisation (requires server)
  images: { unoptimized: true },
  // Trailing slash so Tauri can load index.html from file:// paths
  trailingSlash: true,
};

export default nextConfig;
