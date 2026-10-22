import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/app", label: "Tutor" },
  { href: "/create", label: "Create" },
  { href: "/study", label: "Study" },
  { href: "/parent", label: "Parent" },
  { href: "/settings", label: "Settings" },
];

/** Frame for the standalone pages (settings, study, parent dashboard). */
export function PageShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <nav className="mb-8 flex flex-wrap items-center gap-1 text-sm">
        <Link href="/" className="mr-3 font-[family-name:var(--font-display)] text-lg font-semibold text-white">
          PaperPilot
        </Link>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-[#8ca3be] hover:bg-white/[0.06] hover:text-white">
            {n.label}
          </Link>
        ))}
      </nav>
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-white">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-[#8ca3be]">{subtitle}</p>}
      <div className="mt-8 space-y-6">{children}</div>
    </main>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wider text-[#8ca3be]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export const btn =
  "rounded-lg bg-[#00d4aa] px-4 py-2 text-sm font-semibold text-[#06091a] hover:bg-[#00e6b8] disabled:opacity-40";
export const btnGhost =
  "rounded-lg border border-white/10 px-3 py-1.5 text-sm text-[#c5d4e6] hover:bg-white/[0.06] disabled:opacity-40";
export const input =
  "w-full rounded-lg border border-white/10 bg-[#080d1c] px-3 py-2 text-sm text-white outline-none placeholder:text-[#415570] focus:border-[#00d4aa]/60";
