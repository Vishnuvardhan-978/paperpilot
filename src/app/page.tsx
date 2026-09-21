import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(15,118,110,0.16),transparent_42%),radial-gradient(circle_at_80%_0%,rgba(11,31,51,0.12),transparent_35%),linear-gradient(180deg,#eef3f7_0%,#e4edf4_100%)]"
      />
      <div
        aria-hidden
        className="animate-drift pointer-events-none absolute -right-16 top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(15,118,110,0.22),transparent_70%)] blur-2xl"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-ink">
          PaperPilot
        </div>
        <Link
          href="/app"
          className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-soft"
        >
          Open app
        </Link>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20 pt-10 md:pt-16">
        <section className="animate-rise max-w-3xl min-h-[58vh] flex flex-col justify-center">
          <h1 className="font-[family-name:var(--font-display)] text-5xl font-semibold leading-[1.05] tracking-tight text-ink md:text-7xl">
            PaperPilot
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-muted md:text-xl">
            Stop digging through PDFs. Upload a document and ask for answers in
            plain English — invoices, resumes, reports, manuals.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/app"
              className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_var(--glow)] transition hover:bg-accent-hover"
            >
              Try live demo
            </Link>
            <span className="text-sm text-muted">
              Free MVP · no signup · chats saved locally
            </span>
          </div>
        </section>

        <section className="animate-rise mt-8 max-w-4xl border-t border-line/70 pt-12">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink md:text-3xl">
            Built for people buried in documents
          </h2>
          <p className="mt-3 max-w-2xl text-muted">
            If your work runs on PDFs, PaperPilot turns them into a chat you can
            query in seconds.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ["Founders & freelancers", "Scan contracts and proposals faster"],
              ["HR & recruiters", "Ask resumes direct questions"],
              ["Ops & finance", "Pull totals and details from invoices"],
            ].map(([title, copy]) => (
              <div
                key={title}
                className="rounded-2xl border border-line/80 bg-panel/70 px-5 py-4 backdrop-blur"
              >
                <div className="text-sm font-semibold text-ink">{title}</div>
                <p className="mt-1 text-sm text-muted">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="animate-rise mt-12 max-w-4xl rounded-3xl border border-line/80 bg-panel/80 px-6 py-8 backdrop-blur md:px-8">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-ink">
            Want this for your team?
          </h2>
          <p className="mt-3 max-w-2xl text-muted">
            I build custom AI document tools for businesses — private setups,
            your workflows, your files. Book a free 15-min demo.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/app"
              className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink-soft"
            >
              See how it works
            </Link>
            <a
              href="https://www.linkedin.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-line bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-accent"
            >
              Request a demo on LinkedIn
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
