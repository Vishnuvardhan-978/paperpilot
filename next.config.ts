import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow opening the app from this machine's LAN IP in development
  allowedDevOrigins: ["172.16.3.173", "10.3.1.130", "172.16.0.46"],
  // Allow file uploads up to 10MB (FormData to /api/extract)
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    proxyClientMaxBodySize: "10mb",
  },
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js"],
};

export default nextConfig;
