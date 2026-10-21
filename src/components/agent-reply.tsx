"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { AgentRunView, AgentStepView } from "@/lib/chat-store";

const VERB_ICON: Record<string, string> = {
  Read: "◧",
  Search: "⌕",
  "Find files": "⌕",
  List: "☰",
  Edit: "✎",
  Write: "✚",
  Run: "›_",
};

function StepRow({ step, onOpenFile }: { step: AgentStepView; onOpenFile?: (path: string) => void }) {
  const clickable = Boolean(step.changedPath && onOpenFile);
  return (
    <li className={`agent-step is-${step.status}`}>
      <span className="agent-step-icon">{step.status === "running" ? <span className="agent-spin" /> : VERB_ICON[step.verb] || "•"}</span>
      <span className="agent-step-verb">{step.verb}</span>
      {clickable ? (
        <button type="button" className="agent-step-target is-link" onClick={() => onOpenFile?.(step.changedPath!)} title="Open diff">
          {step.target}
        </button>
      ) : (
        <span className="agent-step-target" title={step.target}>
          {step.target}
        </span>
      )}
      {step.status === "error" && step.error ? (
        <span className="agent-step-error" title={step.error}>
          {step.error}
        </span>
      ) : null}
    </li>
  );
}

function elapsed(run: AgentRunView) {
  const ms = (run.endedAt ?? Date.now()) - run.startedAt;
  return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function AgentReply({
  run,
  answer,
  onOpenFile,
  onRate,
}: {
  run: AgentRunView;
  answer: string;
  onOpenFile?: (path: string) => void;
  /** Present while this run's full trace is available (this session). */
  onRate?: (rating: "good" | "bad") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rateState, setRateState] = useState<"idle" | "saving" | "error">("idle");
  const expanded = run.working || open;
  const edits = run.steps.filter((s) => s.changedPath);
  const errors = run.steps.filter((s) => s.status === "error").length;

  return (
    <div className="agent-reply">
      {run.steps.length > 0 && (
        <div className="agent-steps">
          <button type="button" className="agent-steps-head" onClick={() => setOpen((v) => !v)} disabled={run.working}>
            <span className={`agent-caret ${expanded ? "is-open" : ""}`}>▸</span>
            <span>
              {run.working ? "Working" : "Worked"} · {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
              {edits.length ? ` · ${new Set(edits.map((s) => s.changedPath)).size} file${edits.length === 1 ? "" : "s"} edited` : ""}
              {errors ? ` · ${errors} failed` : ""}
            </span>
            <span className="ml-auto text-[#415570]">{elapsed(run)}</span>
          </button>
          {expanded && (
            <ul className="agent-step-list">
              {run.steps.map((s) => (
                <StepRow key={s.id} step={s} onOpenFile={onOpenFile} />
              ))}
            </ul>
          )}
        </div>
      )}

      {run.working && (
        <div className="agent-thinking">
          <span className="agent-spin" />
          <span>{run.thinking || (run.steps.length ? "Working…" : "Thinking…")}</span>
        </div>
      )}

      {answer ? (
        <div className="prose-ai agent-answer">
          <ReactMarkdown>{answer}</ReactMarkdown>
        </div>
      ) : null}

      {!run.working && edits.length > 0 && onOpenFile && (
        <div className="agent-files">
          {[...new Set(edits.map((s) => s.changedPath!))].map((p) => (
            <button key={p} type="button" className="agent-file-chip" onClick={() => onOpenFile(p)}>
              ✎ {p.split("/").pop()}
            </button>
          ))}
        </div>
      )}

      {!run.working && (onRate || run.rating) && (
        <div className="agent-rate">
          {run.rating ? (
            <span className="agent-rate-done">{run.rating === "good" ? "👍 Saved as a good example" : "👎 Saved as a bad example"}</span>
          ) : (
            <span>Help train PaperPilot:</span>
          )}
          {onRate &&
            (["good", "bad"] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`agent-rate-btn ${run.rating === r ? "is-active" : ""}`}
                disabled={rateState === "saving" || run.rating === r}
                title={r === "good" ? "Good answer: save as a training example" : "Bad answer: save so the model learns what to avoid"}
                onClick={async () => {
                  setRateState("saving");
                  try {
                    await onRate(r);
                    setRateState("idle");
                  } catch {
                    setRateState("error");
                  }
                }}
              >
                {r === "good" ? "👍" : "👎"}
              </button>
            ))}
          {rateState === "error" && <span className="agent-rate-error">Could not save — try again</span>}
        </div>
      )}
    </div>
  );
}
