import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PaperPilot",
    short_name: "PaperPilot",
    description: "Truth Tutor — grounded answers from your documents",
    start_url: "/app",
    display: "standalone",
    background_color: "#06091a",
    theme_color: "#00d4aa",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Study", url: "/study" },
      { name: "Parent dashboard", url: "/parent" },
    ],
  };
}
