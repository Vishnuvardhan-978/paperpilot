/**
 * Training examples for PaperPilot-Coder, collected from rated agent runs.
 * One JSON line per rating in the standard chat fine-tuning format ({ messages, tools }),
 * so the file can be fed to common fine-tuning tools (Unsloth, TRL, OpenAI-style trainers).
 * Re-rating appends a new line with the same id; the export keeps the latest one.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { AGENT_FUNCTIONS, buildAgentSystemPrompt, buildAgentUserMessage } from "@/lib/agent-tools";
import { toOpenAIMessages, toolsFromDeclarations } from "@/lib/ai/openai-compat";
import type { AgentContent } from "@/lib/gemini";

export const TRAINING_DIR = process.env.PAPERPILOT_TRAINING_DIR?.trim() || path.join(os.homedir(), ".paperpilot", "training");
export const EXAMPLES_FILE = path.join(TRAINING_DIR, "examples.jsonl");

export type TraceInput = {
  id: string;
  rating: "good" | "bad";
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  project: { name: string; root?: string; paths: string[] };
  focusPath?: string | null;
  turns: AgentContent[];
  model?: string | null;
};

export function buildExample(t: TraceInput) {
  const system = buildAgentSystemPrompt({ projectName: t.project.name, root: t.project.root, paths: t.project.paths, focusPath: t.focusPath });
  const contents: AgentContent[] = [{ role: "user", parts: [{ text: buildAgentUserMessage({ question: t.question, history: t.history }) }] }, ...t.turns];
  const messages = toOpenAIMessages(system, contents);
  return {
    id: t.id,
    rating: t.rating,
    createdAt: new Date().toISOString(),
    model: t.model || null,
    question: t.question,
    messages,
    tools: toolsFromDeclarations(AGENT_FUNCTIONS),
  };
}

export async function saveExample(t: TraceInput) {
  const example = buildExample(t);
  await fs.mkdir(/*turbopackIgnore: true*/ TRAINING_DIR, { recursive: true });
  await fs.appendFile(/*turbopackIgnore: true*/ EXAMPLES_FILE, `${JSON.stringify(example)}\n`);
  return { messages: example.messages.length };
}
