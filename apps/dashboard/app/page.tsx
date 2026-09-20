import Link from "next/link";
import type { Metadata } from "next";
import { Button, Plus1Mark, Wordmark } from "@/components/ui";
import { Arrow } from "@/components/icons";
import { SiteNav } from "@/components/site/SiteNav";
import { WorldMap } from "@/components/site/WorldMap";
import { ConsolePreview } from "@/components/site/ConsolePreview";
import { ConsoleButton } from "@/components/site/ConsoleButton";

export const metadata: Metadata = {
  title: "plus1 — the meeting AI that joins the meeting",
};

const PROBLEMS = [
  {
    title: "The summary arrives after the decision",
    body: "Recaps land in your inbox once everyone has logged off and moved on. The moment where a correction would have mattered has already closed.",
  },
  {
    title: "Nobody opens the transcript",
    body: "An hour of talking becomes four thousand words of unstructured text. It is searchable in theory and unread in practice.",
  },
  {
    title: "The work still lands on you",
    body: "The assistant heard the action item, understood it, wrote it down — and then handed it back to you to actually do. Nothing was taken off anyone's plate.",
  },
];


export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-bg text-fg">
      <SiteNav />

      {/* ------------------------------------------------------------ hero -- */}
      <section className="mx-auto max-w-[1200px] px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-16">
          <div className="rise">
            <h1 className="text-[clamp(2.75rem,6.2vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-balance text-fg">
              Bring more of yourself.
            </h1>

            <p className="mt-6 max-w-[54ch] text-[clamp(1rem,1.5vw,1.175rem)] leading-relaxed text-fg-muted">
              plus1 is a class-platform video agent that joins your calls. It hears the room, converses with you, and takes immediate action to ensure things get done, now!
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <ConsoleButton />
            </div>
          </div>

          <div className="rise" style={{ animationDelay: "120ms" }}>
            <WorldMap />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- features -- */}
      <section id="features" className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="mb-4 text-[13px] font-medium uppercase tracking-[0.1em] text-fg-subtle">
            How it works
          </div>
          <h2 className="max-w-[22ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-balance">
            Your meetings, upgraded.
          </h2>
          <p className="mt-5 max-w-[58ch] text-[17px] leading-relaxed text-fg-muted">
            plus1 is a real participant — with a face, a voice, and the ability to act — not a recorder quietly running in the background.
          </p>

          <div className="mt-16 flex flex-col gap-24">

            {/* Feature 1 — image left */}
            <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div className="flex items-center justify-center bg-white p-6">
                <img
                  src="/feature-1.png"
                  alt="Two call windows — a person and a smiling AI companion joining the meeting"
                  width={420}
                  height={280}
                  className="h-auto w-full max-w-[380px] object-contain"
                />
              </div>
              <div>
                <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: "#888888" }}>
                  Feature 01
                </div>
                <h3 className="text-[clamp(1.4rem,2.8vw,2rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">
                  A live AI companion that joins your call.
                </h3>
                <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-fg-muted">
                  plus1 enters the meeting as a visible guest — voice and video all included. It isn't lurking in a sidebar. It's in the room, right alongside you.
                </p>
              </div>
            </div>

            {/* Feature 2 — image right */}
            <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: "#888888" }}>
                  Feature 02
                </div>
                <h3 className="text-[clamp(1.4rem,2.8vw,2rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">
                  It speaks, responds, and ideates with you.
                </h3>
                <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-fg-muted">
                  Say its name and it answers out loud. It interjects with facts, bounces ideas back at you, and summarizes the thread — turning the meeting into a real conversation rather than a monologue.
                </p>
              </div>
              <div className="flex items-center justify-center bg-white p-6">
                <img
                  src="/feature-2.png"
                  alt="Goose speaking and interjecting with a fact during a meeting"
                  width={300}
                  height={200}
                  className="h-auto w-full max-w-[260px] object-contain"
                />
              </div>
            </div>

            {/* Feature 3 — image left */}
            <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
              <div className="flex items-center justify-center bg-white p-6">
                <img
                  src="/feature-3.png"
                  alt="An action being created and executed in real time from a spoken request"
                  width={300}
                  height={200}
                  className="h-auto w-full max-w-[260px] object-contain"
                />
              </div>
              <div>
                <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: "#888888" }}>
                  Feature 03
                </div>
                <h3 className="text-[clamp(1.4rem,2.8vw,2rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-fg">
                  Actions happen the moment they're spoken.
                </h3>
                <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-fg-muted">
                  When something needs to be done, it's done — before the topic changes. No more action items getting buried under three more meetings. This is what separates plus1 from everything else out there.
                </p>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- console --
          Sits directly under the hero on purpose: the console is the only thing
          here a competitor's landing page cannot show. */}
      <section className="border-t border-border bg-white">
        <div className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8 sm:py-20">
          <h2 className="max-w-[22ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-balance">
            This is what you watch while you talk.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fg-muted">
            The console runs on your second screen. It shows what plus1 heard,
            how it classified each line, what it retrieved, and what it did
            about it — auditable as it happens, not reconstructed afterwards
            from a log.
          </p>

          <div className="mt-10">
            <ConsolePreview />
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/app/meetings/s_htn_sponsor_01">
              <Button variant="primary" size="lg">
                Watch a full meeting replay
                <Arrow width={16} height={16} />
              </Button>
            </Link>
            <p className="text-[13.5px] text-fg-subtle">
              Replayed end to end, with every gate decision shown as it lands.
            </p>
            <img src="/shrug.png" alt="" className="ml-auto h-[104px] w-auto" />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- problem -- */}
      <section id="problem" className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <h2 className="max-w-[20ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-balance">
            Every meeting assistant is a recorder.
          </h2>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-fg-muted">
            It sits outside the conversation, transcribes what happened, and
            hands you a summary once everyone has left. That model has three
            problems, and they are all the same problem.
          </p>

          <div className="mt-14 border-t border-border">
            {PROBLEMS.map((p) => (
              <div
                key={p.title}
                className="grid grid-cols-1 gap-x-10 gap-y-3 border-b border-border py-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
              >
                <h3 className="text-[19px] font-medium tracking-[-0.025em] text-fg">
                  {p.title}
                </h3>
                <p className="max-w-[64ch] text-[15.5px] leading-relaxed text-fg-muted">
                  {p.body}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-10 max-w-[56ch] text-[19px] leading-snug tracking-[-0.02em] text-fg">
            All three come from the same place: the assistant was never in the
            room. plus1 is.
          </p>
        </div>
      </section>


      {/* ------------------------------------------------------------- cta -- */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="max-w-[16ch] text-[clamp(1.875rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-balance">
                Send a plus1 to your next meeting.
              </h2>
              <p className="mt-4 max-w-[52ch] text-[16.5px] leading-relaxed text-fg-muted">
                Paste a Meet link, pick what it is there to do, and let it in.
                It is unmistakably artificial, and that is the point.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <ConsoleButton />
              <Link href="/app/personas">
                <Button variant="secondary" size="lg">
                  Browse personas
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer -- */}
      <footer className="border-t border-border bg-bg-subtle">
        <div className="mx-auto max-w-[1200px] px-5 py-12 sm:px-8">
          <div className="flex flex-col gap-8 md:flex-row md:justify-between">
            <div>
              <Wordmark markSize={22} />
              <p className="mt-3 max-w-[38ch] text-[13.5px] leading-relaxed text-fg-muted">
                A plus one, not a replacement. Clearly artificial, doing real
                work beside you.
              </p>
            </div>

            <nav className="flex flex-wrap gap-x-14 gap-y-8">
              <div>
                <p className="eyebrow mb-3">Product</p>
                <ul className="flex flex-col gap-2">
                  {[
                    { href: "/app", label: "Console" },
                    { href: "/app/meetings", label: "Meetings" },
                    { href: "/app/personas", label: "Personas" },
                    { href: "/app/integrations", label: "Tools" },
                  ].map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="text-[13.5px] text-fg-muted transition-colors hover:text-fg"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-3">This page</p>
                <ul className="flex flex-col gap-2">
                  {[
                    { href: "#features", label: "Features" },
                    { href: "#problem", label: "The problem" },
                    { href: "#gate", label: "The gate" },
                    { href: "#capabilities", label: "What it does" },
                    { href: "#limits", label: "Limits" },
                  ].map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        className="text-[13.5px] text-fg-muted transition-colors hover:text-fg"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
            <p className="flex items-center gap-2 text-[13px] text-fg-muted">
              Built with
              <span aria-label="love" style={{ color: "var(--alert)" }}>
                &hearts;
              </span>
              at Hack the North 2026
            </p>
            <p className="flex items-center gap-2 text-[13px] text-fg-subtle">
              <Plus1Mark size={15} className="text-fg-subtle" />
              Honk.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
