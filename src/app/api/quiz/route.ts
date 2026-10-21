import { streamText } from "@/lib/ai";
import { formatAskError } from "@/lib/gemini";
import { lensSystemRules, type LensId } from "@/lib/lenses";
import { parseQuiz } from "@/lib/learning";
import { allowRequest, clientKeyFromRequest } from "@/lib/api-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const LENSES: LensId[] = ["kid", "study", "normal", "proof", "bridge"];

/** Multiple-choice quiz as JSON, from a topic or pasted source text. */
export async function POST(request: Request) {
  const gate = allowRequest(`quiz:${clientKeyFromRequest(request)}`, 10, 60_000);
  if (!gate.ok) return Response.json({ error: `Too many quizzes. Try again in ~${gate.retryAfterSec}s.` }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { topic?: string; sourceText?: string; lens?: LensId; count?: number };
  const topic = body.topic?.trim().slice(0, 300) || "";
  const sourceText = body.sourceText?.trim().slice(0, 40_000) || "";
  const lens = LENSES.includes(body.lens as LensId) ? (body.lens as LensId) : "study";
  const count = Math.min(10, Math.max(3, Number(body.count) || 5));
  if (!topic && !sourceText) return Response.json({ error: "Give a topic or some source text." }, { status: 400 });

  const prompt = `${lensSystemRules(lens)}

Write a ${count}-question multiple-choice quiz${topic ? ` about: ${topic}` : ""}.
${sourceText ? `Base every question only on this source text:\n"""\n${sourceText}\n"""\n` : ""}
Each question has exactly 4 choices and one correct answer. Match the difficulty to the lens.
Reply with ONLY a JSON array, no prose, no code fence:
[{"q":"question","choices":["A","B","C","D"],"answer":0,"why":"one-sentence explanation"}]
"answer" is the 0-based index of the correct choice.`;

  try {
    let text = "";
    for await (const chunk of streamText(prompt)) text += chunk;
    const questions = parseQuiz(text);
    if (!questions.length) return Response.json({ error: "The AI didn't return a usable quiz. Try again." }, { status: 502 });
    return Response.json({ questions, lens, topic: topic || "Source text" });
  } catch (error) {
    const { message, status } = formatAskError(error);
    return Response.json({ error: message }, { status });
  }
}
