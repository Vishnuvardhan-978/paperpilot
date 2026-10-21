/**
 * Flashcard deck with spaced repetition (SM-2) and quiz history per lens.
 * Lives in localStorage; the parent dashboard and study page read the same data.
 */
import type { LensId } from "@/lib/lenses";

export type Grade = "again" | "hard" | "good" | "easy";

export type DeckCard = {
  id: string;
  front: string;
  back: string;
  source: string;
  lens: LensId;
  createdAt: number;
  /** Next review time (ms). */
  due: number;
  /** Days until the next review after a correct answer. */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
};

export type QuizQuestion = { q: string; choices: string[]; answer: number; why?: string };

export type QuizResult = {
  id: string;
  at: number;
  lens: LensId;
  topic: string;
  correct: number;
  total: number;
  /** Questions answered wrong, kept so they can become flashcards. */
  missed: { q: string; answer: string }[];
};

const DECK_KEY = "paperpilot-deck";
const QUIZ_KEY = "paperpilot-quiz-history";
const DAY = 86_400_000;

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked */
  }
}

function newCardId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** SM-2 scheduling: returns the card after one review. */
export function review(card: DeckCard, grade: Grade, now = Date.now()): DeckCard {
  const q = { again: 1, hard: 3, good: 4, easy: 5 }[grade];
  const ease = Math.max(1.3, card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  if (grade === "again") {
    return { ...card, ease, reps: 0, lapses: card.lapses + 1, interval: 0, due: now + 10 * 60_000 };
  }
  let interval: number;
  if (card.reps === 0) interval = grade === "easy" ? 4 : grade === "hard" ? 0.5 : 1;
  else if (card.reps === 1) interval = grade === "easy" ? 8 : grade === "hard" ? 3 : 6;
  else interval = card.interval * (grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease);
  interval = Math.round(interval * 10) / 10;
  return { ...card, ease, reps: card.reps + 1, interval, due: now + interval * DAY };
}

export function getDeck(): DeckCard[] {
  return load<DeckCard[]>(DECK_KEY, []);
}

export function saveDeck(deck: DeckCard[]) {
  store(DECK_KEY, deck);
}

/** Add cards, skipping ones already in the deck (same front). Returns how many were added. */
export function addCards(cards: { front: string; back: string }[], source: string, lens: LensId = "study"): number {
  const deck = getDeck();
  const seen = new Set(deck.map((c) => c.front.trim().toLowerCase()));
  const now = Date.now();
  let added = 0;
  for (const c of cards) {
    const key = c.front.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deck.push({ id: newCardId(), front: c.front.trim(), back: c.back.trim(), source, lens, createdAt: now, due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 });
    added++;
  }
  saveDeck(deck);
  return added;
}

export function dueCards(deck = getDeck(), now = Date.now()) {
  return deck.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

export function getQuizHistory(): QuizResult[] {
  return load<QuizResult[]>(QUIZ_KEY, []);
}

export function recordQuiz(result: Omit<QuizResult, "id" | "at">) {
  const history = getQuizHistory();
  history.push({ ...result, id: newCardId(), at: Date.now() });
  store(QUIZ_KEY, history.slice(-500));
}

export type LensProgress = { lens: LensId; quizzes: number; correct: number; total: number; cards: number; mastered: number };

/** Per-lens totals for the study and parent pages. A card counts as mastered once its interval reaches 21 days. */
export function progressByLens(deck = getDeck(), history = getQuizHistory()): LensProgress[] {
  const lenses: LensId[] = ["kid", "study", "normal", "proof", "bridge"];
  return lenses.map((lens) => {
    const qs = history.filter((h) => h.lens === lens);
    const cs = deck.filter((c) => c.lens === lens);
    return {
      lens,
      quizzes: qs.length,
      correct: qs.reduce((n, h) => n + h.correct, 0),
      total: qs.reduce((n, h) => n + h.total, 0),
      cards: cs.length,
      mastered: cs.filter((c) => c.interval >= 21).length,
    };
  });
}

/** Pull a JSON array of quiz questions out of a model answer. */
export function parseQuiz(text: string): QuizQuestion[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown[];
    return raw
      .map((r) => r as Partial<QuizQuestion>)
      .filter(
        (r): r is QuizQuestion =>
          typeof r.q === "string" &&
          Array.isArray(r.choices) &&
          r.choices.length >= 2 &&
          r.choices.every((c) => typeof c === "string") &&
          typeof r.answer === "number" &&
          r.answer >= 0 &&
          r.answer < r.choices.length,
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}
