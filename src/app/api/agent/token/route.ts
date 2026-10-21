import { readFile } from "fs/promises";
import os from "os";
import path from "path";
import { localRequestProblem } from "@/lib/server/local-request";

export const runtime = "nodejs";

function tokenFile() {
  return process.env.PAPERPILOT_TOKEN_FILE || path.join(os.homedir(), ".paperpilot", "agent-token");
}

/** Hands the local agent's secret to PaperPilot's own pages only. */
export async function GET(request: Request) {
  const problem = localRequestProblem(request);
  if (problem) {
    return Response.json({ error: problem === "Only available on this machine." ? "The agent token is only served on this machine." : problem }, { status: 403 });
  }

  let token = process.env.PAPERPILOT_AGENT_TOKEN?.trim() || "";
  if (!token) {
    try {
      token = (await readFile(/*turbopackIgnore: true*/ tokenFile(), "utf8")).trim();
    } catch {
      return Response.json(
        { error: "Local agent has not started yet. Run: npm run agent" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
