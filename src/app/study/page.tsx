"use client";

import { useEffect, useState } from "react";
import { Card, PageShell, btn, btnGhost, input } from "@/components/page-shell";
import { ProgressTable } from "@/components/progress-table";
import { LENSES, type LensId } from "@/lib/lenses";
import {
  addCards,
  dueCards,
  getDeck,
  getQuizHistory,
  recordQuiz,
  review,
  saveDeck,
  type DeckCard,
  type Grade,
  type QuizQuestion,
  type QuizResult,
} from "@/lib/learning";

type Tab = "review" | "quiz" | "deck" | "progress";

export default function StudyPage() {
  const [tab, setTab] = useState<Tab>("review");
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [history, setHistory] = useState<QuizResult[]>([]);

  useEffect(() => {
    // localStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeck(getDeck());
    setHistory(getQuizHistory());
  }, []);

  function refresh() {
    setDeck(getDeck());
    setHistory(getQuizHistory());
  }

  const due = dueCards(deck);
  const tabs: { id: Tab; label: string }[] = [
    { id: "review", label: `Review${due.length ? ` (${due.length})` : ""}` },
    { id: "quiz", label: "Quiz" },
    { id: "deck", label: `Deck (${deck.length})` },
    { id: "progress", label: "Progress" },
  ];

  return (
    <PageShell title="Study" subtitle="Flashcards come back right before you'd forget them. Quizzes track how you do in each lens.">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === t.id ? "bg-[#00d4aa]/15 text-[#00d4aa]" : "text-[#8ca3be] hover:bg-white/[0.06]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "review" && <Review due={due} onChange={refresh} />}
      {tab === "quiz" && <Quiz onDone={refresh} />}
      {tab === "deck" && <Deck deck={deck} onChange={refresh} />}
      {tab === "progress" && <Progress deck={deck} history={history} />}
    </PageShell>
  );
}

function Review({ due, onChange }: { due: DeckCard[]; onChange: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const card = due[0];

  function grade(g: Grade) {
    const deck = getDeck().map((c) => (c.id === card.id ? review(c, g) : c));
    saveDeck(deck);
    setFlipped(false);
    onChange();
  }

  if (!card) {
    return (
      <Card>
        <p className="text-sm text-[#c5d4e6]">Nothing due right now.</p>
        <p className="mt-1 text-xs text-[#415570]">Save flashcards from a tutor answer, add your own in Deck, or turn missed quiz questions into cards.</p>
      </Card>
    );
  }

  return (
    <Card title={`${due.length} due · from ${card.source}`}>
      <button
        type="button"
        onClick={() => setFlipped(true)}
        className="block min-h-40 w-full rounded-xl border border-white/10 bg-[#080d1c] p-6 text-left"
      >
        <p className="text-lg text-white">{card.front}</p>
        {flipped ? (
          <p className="mt-4 border-t border-white/10 pt-4 text-[#c5d4e6]">{card.back}</p>
        ) : (
          <p className="mt-4 text-xs text-[#415570]">Tap to show the answer</p>
        )}
      </button>
      {flipped && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["again", "hard", "good", "easy"] as Grade[]).map((g) => (
            <button key={g} type="button" onClick={() => grade(g)} className={g === "good" ? btn : btnGhost}>
              {g[0].toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function LensPicker({ value, onChange }: { value: LensId; onChange: (l: LensId) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {LENSES.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => onChange(l.id)}
          className={`rounded-full border px-3 py-1 text-xs ${value === l.id ? "border-[#00d4aa]/60 text-[#00d4aa]" : "border-white/10 text-[#8ca3be]"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function Quiz({ onDone }: { onDone: () => void }) {
  const [lens, setLens] = useState<LensId>("study");
  const [topic, setTopic] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<{ questions: QuizQuestion[]; topic: string; lens: LensId } | null>(null);
  const [picks, setPicks] = useState<(number | null)[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [savedMissed, setSavedMissed] = useState<number | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    setQuiz(null);
    setSubmitted(false);
    setSavedMissed(null);
    try {
      const r = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, sourceText, lens, count: 5 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Quiz failed");
      setQuiz(data);
      setPicks(data.questions.map(() => null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (!quiz) return;
    const missed = quiz.questions
      .filter((q, i) => picks[i] !== q.answer)
      .map((q) => ({ q: q.q, answer: q.choices[q.answer] + (q.why ? ` — ${q.why}` : "") }));
    recordQuiz({ lens: quiz.lens, topic: quiz.topic, correct: quiz.questions.length - missed.length, total: quiz.questions.length, missed });
    setSubmitted(true);
    onDone();
  }

  function saveMissed() {
    if (!quiz) return;
    const missed = quiz.questions.filter((q, i) => picks[i] !== q.answer);
    setSavedMissed(addCards(missed.map((q) => ({ front: q.q, back: q.choices[q.answer] + (q.why ? ` — ${q.why}` : "") })), `Quiz: ${quiz.topic}`, quiz.lens));
    onDone();
  }

  const score = quiz ? quiz.questions.filter((q, i) => picks[i] === q.answer).length : 0;

  return (
    <>
      <Card title="New quiz">
        <div className="space-y-3">
          <LensPicker value={lens} onChange={setLens} />
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic, e.g. photosynthesis" className={input} />
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Optional: paste notes or a chapter so questions come only from it"
            rows={4}
            className={input}
          />
          <div className="flex items-center gap-3">
            <button type="button" className={btn} disabled={loading || (!topic.trim() && !sourceText.trim())} onClick={() => void start()}>
              {loading ? "Writing quiz…" : "Start quiz"}
            </button>
            {error && <span className="text-sm text-red-300">{error}</span>}
          </div>
        </div>
      </Card>

      {quiz && (
        <Card title={`${quiz.topic} · ${quiz.lens}`}>
          <ol className="space-y-5">
            {quiz.questions.map((q, i) => (
              <li key={i}>
                <p className="mb-2 text-sm text-white">
                  {i + 1}. {q.q}
                </p>
                <div className="grid gap-2">
                  {q.choices.map((c, j) => {
                    const picked = picks[i] === j;
                    const tone = submitted
                      ? j === q.answer
                        ? "border-[#00d4aa]/60 bg-[#00d4aa]/10 text-[#00d4aa]"
                        : picked
                          ? "border-red-400/40 bg-red-500/10 text-red-300"
                          : "border-white/10 text-[#8ca3be]"
                      : picked
                        ? "border-[#00d4aa]/60 text-white"
                        : "border-white/10 text-[#c5d4e6] hover:bg-white/[0.04]";
                    return (
                      <button
                        key={j}
                        type="button"
                        disabled={submitted}
                        onClick={() => setPicks((p) => p.map((v, k) => (k === i ? j : v)))}
                        className={`rounded-lg border px-3 py-2 text-left text-sm ${tone}`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                {submitted && q.why && <p className="mt-2 text-xs text-[#8ca3be]">{q.why}</p>}
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!submitted ? (
              <button type="button" className={btn} disabled={picks.some((p) => p === null)} onClick={submit}>
                Check answers
              </button>
            ) : (
              <>
                <span className="text-sm text-white">
                  {score}/{quiz.questions.length} correct
                </span>
                {score < quiz.questions.length && savedMissed === null && (
                  <button type="button" className={btnGhost} onClick={saveMissed}>
                    Turn missed questions into flashcards
                  </button>
                )}
                {savedMissed !== null && <span className="text-sm text-[#00d4aa]">Added {savedMissed} cards</span>}
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function Deck({ deck, onChange }: { deck: DeckCard[]; onChange: () => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [filter, setFilter] = useState("");
  const [now] = useState(() => Date.now());

  const shown = deck.filter((c) => `${c.front} ${c.back} ${c.source}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <Card title="Add a card">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={front} onChange={(e) => setFront(e.target.value)} placeholder="Question" className={input} />
          <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="Answer" className={input} />
          <button
            type="button"
            className={btn}
            disabled={!front.trim() || !back.trim()}
            onClick={() => {
              addCards([{ front, back }], "My cards");
              setFront("");
              setBack("");
              onChange();
            }}
          >
            Add
          </button>
        </div>
      </Card>
      <Card title="All cards">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search cards" className={`${input} mb-3`} />
        {shown.length === 0 && <p className="text-sm text-[#415570]">No cards yet.</p>}
        <ul className="divide-y divide-white/[0.06]">
          {shown.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white">{c.front}</p>
                <p className="mt-0.5 text-sm text-[#8ca3be]">{c.back}</p>
                <p className="mt-1 text-[11px] text-[#415570]">
                  {c.source} · {c.lens} · {c.due <= now ? "due now" : `next in ${Math.ceil((c.due - now) / 86_400_000)}d`}
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-red-300 hover:underline"
                onClick={() => {
                  saveDeck(getDeck().filter((d) => d.id !== c.id));
                  onChange();
                }}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Progress({ deck, history }: { deck: DeckCard[]; history: QuizResult[] }) {
  return (
    <>
      <Card title="By lens">
        <ProgressTable deck={deck} history={history} />
      </Card>
      <Card title="Recent quizzes">
        {history.length === 0 && <p className="text-sm text-[#415570]">No quizzes yet.</p>}
        <ul className="space-y-2 text-sm">
          {[...history].reverse().slice(0, 15).map((h) => (
            <li key={h.id} className="flex justify-between gap-3 text-[#c5d4e6]">
              <span className="truncate">
                {h.topic} <span className="text-[#415570]">· {h.lens}</span>
              </span>
              <span className="shrink-0 text-[#8ca3be]">
                {h.correct}/{h.total} · {new Date(h.at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
