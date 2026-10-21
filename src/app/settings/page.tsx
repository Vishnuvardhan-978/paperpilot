"use client";

import { useEffect, useState } from "react";
import { Card, PageShell, btn, input } from "@/components/page-shell";

type Setting = {
  key: string;
  label: string;
  group: string;
  secret: boolean;
  help?: string;
  placeholder?: string;
  set: boolean;
  preview: string;
};

type Status = { settings: Setting[]; active: string[] };

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/keys")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Could not load settings");
        setStatus(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save(values: Record<string, string>) {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const r = await fetch("/api/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Save failed");
      setStatus(data);
      setDraft({});
      setMessage("Saved to .env.local. New keys work right away.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const groups = status ? [...new Set(status.settings.map((s) => s.group))] : [];
  const dirty = Object.values(draft).some((v) => v.trim());

  return (
    <PageShell
      title="Settings"
      subtitle="API keys are stored in .env.local on this machine only. This page only works from this computer."
    >
      {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {message && <p className="rounded-xl border border-[#00d4aa]/40 bg-[#00d4aa]/10 px-4 py-3 text-sm text-[#00d4aa]">{message}</p>}

      {status && (
        <Card title="Active providers">
          <p className="text-sm text-[#c5d4e6]">
            {status.active.length ? status.active.join(" → ") : "None yet. Add at least one key below."}
          </p>
          <p className="mt-1 text-xs text-[#415570]">Tried in this order; the next one is used when one is rate-limited or down.</p>
        </Card>
      )}

      {status &&
        groups.map((group) => (
          <Card key={group} title={group}>
            <div className="space-y-4">
              {status.settings
                .filter((s) => s.group === group)
                .map((s) => (
                  <div key={s.key}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <label htmlFor={s.key} className="text-[#c5d4e6]">
                        {s.label}
                        {s.help && (
                          <a href={s.help} target="_blank" rel="noreferrer" className="ml-2 text-xs text-[#00d4aa] hover:underline">
                            get one
                          </a>
                        )}
                      </label>
                      {s.set && (
                        <span className="flex items-center gap-2 text-xs text-[#8ca3be]">
                          {s.preview}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void save({ [s.key]: "" })}
                            className="text-red-300 hover:underline disabled:opacity-40"
                          >
                            remove
                          </button>
                        </span>
                      )}
                    </div>
                    <input
                      id={s.key}
                      type={s.secret ? "password" : "text"}
                      autoComplete="off"
                      value={draft[s.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                      placeholder={s.set ? "Leave empty to keep the current value" : s.placeholder || ""}
                      className={input}
                    />
                  </div>
                ))}
            </div>
          </Card>
        ))}

      {status && (
        <div className="flex justify-end">
          <button
            type="button"
            className={btn}
            disabled={!dirty || saving}
            onClick={() => void save(Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim())))}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </PageShell>
  );
}
