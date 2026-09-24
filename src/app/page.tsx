import Link from "next/link";

export default function Home() {
  return (
    <div className="app-mesh app-grain relative min-h-full overflow-x-hidden text-[#f0f4ff]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-drift absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(0,212,170,0.18),transparent_65%)]" />
        <div
          className="animate-drift absolute -right-28 top-16 h-[480px] w-[480px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.14),transparent_65%)]"
          style={{ animationDelay: "2s" }}
        />
        <div className="animate-breathe absolute bottom-0 left-1/2 h-[40vh] w-[80vw] -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(14,165,233,0.08),transparent_70%)]" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="animate-glow flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6] shadow-[0_0_24px_rgba(0,212,170,0.25)]">
            <span className="text-[12px] font-black text-white">PP</span>
          </div>
          <span className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-white">
            PaperPilot
          </span>
        </div>
        <Link
          href="/app"
          className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa]"
        >
          Open app
        </Link>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-8 md:pt-14">
        {/* Hero — brand first, one composition */}
        <section className="relative flex min-h-[72vh] flex-col justify-end overflow-hidden pb-20 pt-16 md:min-h-[82vh] md:justify-center md:pb-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -mx-6 md:-mx-[calc((100vw-72rem)/2)]"
          >
            <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,rgba(0,212,170,0.07)_70%,rgba(59,130,246,0.1)_100%)]" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#00d4aa]/40 to-transparent" />
          </div>

          <div className="animate-rise relative max-w-2xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#00d4aa]">
              Truth Tutor
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-6xl md:text-8xl">
              <span className="brand-underline">PaperPilot</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-[#8ca3be] md:text-xl">
              Learn from your files — or without them. Lenses for every age.
              Grounded when it matters.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/app"
                className="animate-glow rounded-full bg-gradient-to-r from-[#00d4aa] to-[#0ea5e9] px-7 py-3.5 text-sm font-semibold text-white"
              >
                Start tutoring
              </Link>
              <span className="text-sm text-[#415570]">
                Open tutor · Library · Bridge
              </span>
            </div>
          </div>
        </section>

        <section className="animate-rise border-t border-white/[0.08] pt-14">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Built for every learner
          </h2>
          <p className="mt-3 max-w-xl text-[#8ca3be]">
            One tutor. Five lenses. Clear labels when knowledge leaves the page.
          </p>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Kid", "Simple words. Warm tone. Parent-safe."],
              ["Study", "Lessons, quizzes, flashcards."],
              ["Proof", "Quotes you can find in the source."],
              ["Bridge", "Sources vs world — never mixed."],
              ["Open tutor", "Ask anything. No file required."],
              ["Library", "Search every past upload at once."],
            ].map(([title, copy], i) => (
              <div
                key={title}
                className="animate-rise border-l-2 border-[#00d4aa]/35 pl-4"
                style={{ animationDelay: `${0.06 * i}s` }}
              >
                <div className="font-[family-name:var(--font-display)] text-lg font-semibold text-white">
                  {title}
                </div>
                <p className="mt-1.5 text-sm leading-6 text-[#8ca3be]">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="animate-rise mt-16 border-t border-white/[0.08] pt-14">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
            Ready when you are
          </h2>
          <p className="mt-3 max-w-xl text-[#8ca3be]">
            Contracts, homework, manuals, YouTube — or just a question.
          </p>
          <div className="mt-8">
            <Link
              href="/app"
              className="inline-flex rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-[#06091a] transition hover:bg-[#e2e8f0]"
            >
              Open PaperPilot
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
