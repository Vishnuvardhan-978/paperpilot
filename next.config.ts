import type { NextConfig } from "next";
import os from "os";

// LAN IPs change between networks; read them at startup so the dev server accepts this machine's current address.
function currentLanIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
    .map((iface) => iface!.address);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: currentLanIps(),
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
