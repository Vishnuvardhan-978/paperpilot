"use client";

import { useEffect, useState } from "react";
import { Card, PageShell, btn, btnGhost, input } from "@/components/page-shell";
import { ProgressTable } from "@/components/progress-table";
import { getDeck, getQuizHistory, type DeckCard, type QuizResult } from "@/lib/learning";
import {
  checkPin,
  clearKidLog,
  getKidLog,
  getParentSettings,
  hashPin,
  saveParentSettings,
  type KidQuestion,
  type ParentSettings,
} from "@/lib/parental";
import { getAskUsage } from "@/lib/rate-limit";

export default function ParentPage() {
  const [settings, setSettings] = useState<ParentSettings | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    const s = getParentSettings();
    // localStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(s);
    setUnlocked(!s.pinHash);
  }, []);

  if (!settings) return <PageShell title="Parent dashboard">{null}</PageShell>;

  if (!unlocked) {
    return (
      <PageShell title="Parent dashboard" subtitle="Enter your parent PIN.">
        <Card>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await checkPin(pin);
              setPinError(!ok);
              setUnlocked(ok);
              setPin("");
            }}
          >
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" className={input} autoFocus />
            <button type="submit" className={btn}>
              Unlock
            </button>
          </form>
          {pinError && <p className="mt-2 text-sm text-red-300">Wrong PIN.</p>}
        </Card>
      </PageShell>
    );
  }

  return <Dashboard settings={settings} onSettings={setSettings} />;
}

function Dashboard({ settings, onSettings }: { settings: ParentSettings; onSettings: (s: ParentSettings) => void }) {
  const [log, setLog] = useState<KidQuestion[]>([]);
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [history, setHistory] = useState<QuizResult[]>([]);
  const [usage, setUsage] = useState({ used: 0, limit: 0, remaining: 0 });
  const [newPin, setNewPin] = useState("");
  const [pinSaved, setPinSaved] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLog(getKidLog());
    setDeck(getDeck());
    setHistory(getQuizHistory());
    setUsage(getAskUsage());
  }, [settings]);

  const update = (patch: Partial<ParentSettings>) => onSettings(saveParentSettings(patch));
  const kidDeck = deck.filter((c) => c.lens === "kid");
  const kidHistory = history.filter((h) => h.lens === "kid");
  const flagged = log.filter((q) => q.flagged).length;
  const shown = [...log].reverse().filter((q) => !onlyFlagged || q.flagged);

  return (
    <PageShell title="Parent dashboard" subtitle="Settings and activity for this browser.">
      <Card title="Kid mode">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm text-[#c5d4e6]">
            Answer with the Kid lens: simple words, warm tone, sensitive topics sent back to a parent.
          </span>
          <input type="checkbox" checked={settings.kidMode} onChange={(e) => update({ kidMode: e.target.checked })} className="h-5 w-5 accent-[#00d4aa]" />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[#c5d4e6]">
          <label htmlFor="limit">Questions per day</label>
          <input
            id="limit"
            type="number"
            min={1}
            max={200}
            value={settings.dailyLimit}
            onChange={(e) => update({ dailyLimit: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })}
            className={input.replace("w-full", "w-24")}
          />
          {settings.kidMode && (
            <span className="text-xs text-[#8ca3be]">
              {usage.used} used today, {usage.remaining} left
            </span>
          )}
        </div>
      </Card>

      <Card title="Parent PIN">
        <div className="flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => {
              setNewPin(e.target.value);
              setPinSaved(false);
            }}
            placeholder={settings.pinHash ? "New PIN" : "Set a PIN (4+ digits)"}
            className={input}
          />
          <button
            type="button"
            className={btn}
            disabled={newPin.length < 4}
            onClick={async () => {
              update({ pinHash: await hashPin(newPin) });
              setNewPin("");
              setPinSaved(true);
            }}
          >
            Save
          </button>
        </div>
        {pinSaved && <p className="mt-2 text-sm text-[#00d4aa]">PIN saved. You&apos;ll need it to open this page.</p>}
        {!settings.pinHash && <p className="mt-2 text-xs text-amber-200">No PIN yet: anyone on this device can change these settings.</p>}
      </Card>

      <Card title="Learning (Kid lens)">
        <div className="mb-4 grid grid-cols-3 gap-3 text-center">
          <Stat label="Questions asked" value={log.length} />
          <Stat label="Quizzes" value={kidHistory.length} />
          <Stat label="Flashcards" value={kidDeck.length} />
        </div>
        <ProgressTable deck={deck} history={history} />
      </Card>

      <Card
        title={`Questions${flagged ? ` · ${flagged} flagged` : ""}`}
        action={
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={() => setOnlyFlagged((v) => !v)}>
              {onlyFlagged ? "Show all" : "Flagged only"}
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={!log.length}
              onClick={() => {
                clearKidLog();
                setLog([]);
              }}
            >
              Clear
            </button>
          </div>
        }
      >
        {shown.length === 0 && <p className="text-sm text-[#415570]">Nothing yet. Questions are logged while kid mode is on.</p>}
        <ul className="divide-y divide-white/[0.06]">
          {shown.slice(0, 100).map((q) => (
            <li key={q.at} className="flex items-start justify-between gap-3 py-2 text-sm">
              <span className={q.flagged ? "text-amber-200" : "text-[#c5d4e6]"}>
                {q.flagged && "⚑ "}
                {q.question}
              </span>
              <span className="shrink-0 text-xs text-[#415570]">{new Date(q.at).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </Card>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#080d1c] p-3">
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="text-[11px] text-[#8ca3be]">{label}</div>
    </div>
  );
}
