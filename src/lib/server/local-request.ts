import os from "os";

function isThisMachine(hostname: string) {
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const iface of Object.values(os.networkInterfaces()).flat()) {
    if (!iface) continue;
    local.add(iface.family === "IPv6" ? `[${iface.address}]` : iface.address);
  }
  return local.has(hostname.toLowerCase());
}

/**
 * Null when the request comes from PaperPilot's own page on this machine; otherwise the
 * reason to refuse. Cross-site pages fail the same-origin checks, DNS-rebinding pages the Host check.
 */
export function localRequestProblem(request: Request): string | null {
  const host = request.headers.get("host") || "";
  if (!isThisMachine(host.replace(/:\d+$/, ""))) return "Only available on this machine.";
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "Cross-site request blocked.";
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* treated as mismatch */
    }
    if (originHost !== host) return "Cross-site request blocked.";
  }
  return null;
}
