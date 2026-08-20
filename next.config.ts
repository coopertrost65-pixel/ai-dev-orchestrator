import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop shell runs this self-contained server with Electron's bundled
  // Node runtime. The same output remains usable for normal local hosting.
  output: "standalone",
};

export default nextConfig;
