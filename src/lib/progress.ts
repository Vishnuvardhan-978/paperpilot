const STREAK_KEY = "paperpilot-study-streak";

type Streak = {
  day: string;
  count: number;
  best: number;
  quizzes: number;
  claims: number;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function read(): Streak {
  if (typeof window === "undefined") {
    return { day: today(), count: 0, best: 0, quizzes: 0, claims: 0 };
  }
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return { day: today(), count: 0, best: 0, quizzes: 0, claims: 0 };
    const p = JSON.parse(raw) as Streak;
    if (p.day !== today()) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yKey = yesterday.toISOString().slice(0, 10);
      // Reset daily count; keep best. Streak continuity simplified: if missed a day, count restarts on next bump.
      return {
        day: today(),
        count: p.day === yKey ? p.count : 0,
        best: p.best || 0,
        quizzes: 0,
        claims: 0,
      };
    }
    return p;
  } catch {
    return { day: today(), count: 0, best: 0, quizzes: 0, claims: 0 };
  }
}

function write(s: Streak) {
  localStorage.setItem(STREAK_KEY, JSON.stringify(s));
}

export function getStudyStreak() {
  return read();
}

/** Call after a successful grounded ask. */
export function bumpStudyActivity(kind: "ask" | "quiz" | "claim" = "ask") {
  const s = read();
  const next: Streak = {
    day: today(),
    count: s.count + (kind === "ask" ? 1 : 0),
    best: Math.max(s.best, s.count + (kind === "ask" ? 1 : 0)),
    quizzes: s.quizzes + (kind === "quiz" ? 1 : 0),
    claims: s.claims + (kind === "claim" ? 1 : 0),
  };
  if (kind === "quiz") next.count = s.count + 1;
  if (kind === "claim") next.count = s.count + 1;
  next.best = Math.max(s.best, next.count);
  write(next);
  return next;
}
