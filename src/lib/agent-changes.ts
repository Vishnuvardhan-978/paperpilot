import { agentDeleteFile, agentWriteFile } from "@/lib/local-agent";
import { diffStats, lineDiff } from "@/lib/line-diff";

export type AgentChangeStatus = "pending" | "accepted" | "reverted";

/** One file the agent wrote. `before` is the text before the first write of the run. */
export type AgentChange = {
  path: string;
  before: string;
  after: string;
  existed: boolean;
  status: AgentChangeStatus;
  at: number;
};

export function samePath(a: string, b: string) {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

/** Repeated writes to one file keep the original `before`, so Reject restores the pre-agent text. */
export function recordAgentChange(list: AgentChange[], change: Omit<AgentChange, "status" | "at">): AgentChange[] {
  const existing = list.find((c) => samePath(c.path, change.path) && c.status === "pending");
  if (existing) {
    return list.map((c) => (c === existing ? { ...c, after: change.after, at: Date.now() } : c));
  }
  return [...list, { ...change, status: "pending", at: Date.now() }];
}

export function changeStats(change: AgentChange) {
  if (change.before.split("\n").length > 4000 || change.after.split("\n").length > 4000) {
    return { added: 0, removed: 0 };
  }
  return diffStats(lineDiff(change.before, change.after));
}

/** Put the file back to how it was before the agent touched it. */
export async function revertAgentChange(change: AgentChange) {
  if (change.existed) {
    await agentWriteFile(change.path, change.before, { backup: false });
  } else {
    await agentDeleteFile(change.path);
  }
}
