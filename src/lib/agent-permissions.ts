import type { AgentToolName } from "@/lib/agent-tools";

/** What the coding agent may do without asking. Stored per browser. */
export type ToolPolicy = "allow" | "ask" | "deny";

export const TOOL_GROUPS: { id: string; label: string; tools: AgentToolName[]; fallback: ToolPolicy }[] = [
  { id: "read", label: "Read & search files", tools: ["find_files", "list_dir", "read_file", "search_code"], fallback: "allow" },
  { id: "write", label: "Edit & create files", tools: ["edit_file", "write_file", "remove_comments"], fallback: "allow" },
  { id: "terminal", label: "Run terminal commands", tools: ["run_terminal"], fallback: "ask" },
];

const KEY = "paperpilot-agent-permissions";

export function getToolPolicies(): Record<string, ToolPolicy> {
  const base = Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, g.fallback]));
  if (typeof window === "undefined") return base;
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, ToolPolicy>) };
  } catch {
    return base;
  }
}

export function setToolPolicy(group: string, policy: ToolPolicy) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getToolPolicies(), [group]: policy }));
  } catch {
    /* ignore */
  }
}

export function groupForTool(name: string) {
  return TOOL_GROUPS.find((g) => g.tools.includes(name as AgentToolName)) ?? TOOL_GROUPS[2];
}

export function policyForTool(name: string): ToolPolicy {
  return getToolPolicies()[groupForTool(name).id] ?? "ask";
}
