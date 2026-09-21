import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-full overflow-hidden bg-[#06091a] text-[#f0f4ff]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(0,212,170,0.14),transparent_65%)]" />
        <div className="absolute -right-24 top-20 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.12),transparent_65%)]" />
        <div className="animate-drift absolute bottom-10 left-1/3 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(0,212,170,0.08),transparent_70%)] blur-2xl" />
      </div>

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#3b82f6]">
            <span className="text-[11px] font-black text-white">PP</span>
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

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20 pt-10 md:pt-16">
        <section className="animate-rise flex min-h-[58vh] max-w-3xl flex-col justify-center">
          <h1 className="font-[family-name:var(--font-display)] text-5xl font-semibold leading-[1.05] tracking-tight text-white md:text-7xl">
            PaperPilot
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-[#8ca3be] md:text-xl">
            Stop digging through PDFs. Upload documents, preview them, and ask
            for answers in plain English — invoices, resumes, reports, manuals.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/app"
              className="rounded-full bg-gradient-to-r from-[#00d4aa] to-[#0ea5e9] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_30px_rgba(0,212,170,0.3)] transition hover:shadow-[0_0_40px_rgba(0,212,170,0.45)]"
            >
              Try live demo
            </Link>
            <span className="text-sm text-[#415570]">
              Multi-PDF · streaming answers · export chats
            </span>
          </div>
        </section>

        <section className="animate-rise mt-8 max-w-4xl border-t border-white/[0.08] pt-12">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white md:text-3xl">
            Built for people buried in documents
          </h2>
          <p className="mt-3 max-w-2xl text-[#8ca3be]">
            PaperPilot turns PDFs into a chat you can query in seconds — with
            live preview and saved conversations.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ["Founders & freelancers", "Scan contracts and proposals faster"],
              ["HR & recruiters", "Ask resumes direct questions"],
              ["Ops & finance", "Pull totals and details from invoices"],
            ].map(([title, copy]) => (
              <div
                key={title}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 backdrop-blur"
              >
                <div className="text-sm font-semibold text-white">{title}</div>
                <p className="mt-1 text-sm text-[#8ca3be]">{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="animate-rise mt-12 max-w-4xl rounded-3xl border border-white/[0.1] bg-gradient-to-br from-[#00d4aa]/10 to-[#3b82f6]/10 px-6 py-8 backdrop-blur md:px-8">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-white">
            Want this for your team?
          </h2>
          <p className="mt-3 max-w-2xl text-[#8ca3be]">
            Custom AI document tools for businesses — private setups, your
            workflows, your files. Book a free 15-min demo.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/app"
              className="rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#06091a] transition hover:bg-[#e2e8f0]"
            >
              See how it works
            </Link>
            <a
              href="https://www.linkedin.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-[#8ca3be] transition hover:border-[#00d4aa]/40 hover:text-[#00d4aa]"
            >
              Request a demo on LinkedIn
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
