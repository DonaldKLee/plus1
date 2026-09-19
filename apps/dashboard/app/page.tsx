import Link from "next/link";
import type { Metadata } from "next";
import { Button, GooseMark, Wordmark } from "@/components/ui";
import { Arrow } from "@/components/icons";
import { SiteNav } from "@/components/site/SiteNav";
import { WorldMap } from "@/components/site/WorldMap";
import { ConsolePreview } from "@/components/site/ConsolePreview";
import {
  INTENT_META,
  SAMPLE_ACTED,
  SAMPLE_LINES,
} from "@/components/site/sample";

export const metadata: Metadata = {
  title: "plus1 — the meeting AI that joins the meeting",
};

/* Counts are read off the frozen sample beside this page — no invented numbers.
   Latency is deliberately NOT taken from it: the classifier is not built yet,
   so any millisecond figure here would be authored, not measured. */
const gated = SAMPLE_LINES;
const acted = SAMPLE_ACTED;

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

const CAPABILITIES = [
  {
    title: "Answers when addressed",
    body: "Say its name and it retrieves from your corpus and replies out loud in a sentence or two. The room hears the answer while the question is still live.",
    fixes: "No more 'let me check and get back to you'",
  },
  {
    title: "Takes the action item",
    body: "Assign it work and it says 'on it', creates the real Gmail draft in your account, and posts the link in meeting chat before the topic changes.",
    fixes: "The follow-up exists before the meeting ends",
  },
  {
    title: "Reviews what you paste",
    body: "Drop a URL in chat and it opens the page in a cloud browser, reads it, and critiques it out loud with the specific section it has a problem with.",
    fixes: "Review happens in the room, not next week",
  },
  {
    title: "Resolves contradictions",
    body: "When two documents disagree about a number, it finds both, picks one, and tells you which it trusted and why — instead of confidently averaging them.",
    fixes: "Conflicting sources get named, not smoothed over",
  },
  {
    title: "Stays quiet",
    body: "Most of what is said in a meeting needs nothing from an AI. The gate's whole job is to run on every utterance and decide to do nothing — which is the hard part, and the reason the rest of this is bearable to sit next to.",
    fixes: "Present without being exhausting",
  },
  {
    title: "Honks",
    body: "It honks when two people contradict each other, when someone has held the floor past three minutes, and any time anyone types /honk in the chat.",
    fixes: "It is a goose. This is non-negotiable",
  },
];

const LIMITS = [
  "It never speaks unless addressed, or unless an action it took just finished.",
  "Human speech cuts its audio mid-word. You never have to talk over it.",
  "Sending, publishing and deleting always stop for an explicit spoken yes.",
  "Below its confidence threshold it says it is unsure and asks, rather than guessing.",
  "Every tool is set to call automatically, ask first, or never — per persona.",
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
              The meeting AI that joins the meeting.
            </h1>

            <p className="mt-6 max-w-[54ch] text-[clamp(1rem,1.5vw,1.175rem)] leading-relaxed text-fg-muted">
              plus1 is a goose in a business suit that joins your call as a
              visible guest. It hears the room with speaker attribution, answers
              out loud when addressed, and has the email drafted before anyone
              says &ldquo;let&rsquo;s follow up on that&rdquo;.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/app">
                <Button variant="primary" size="lg">
                  Open the console
                  <Arrow width={16} height={16} />
                </Button>
              </Link>
              <a href="#gate">
                <Button variant="secondary" size="lg">
                  See how the gate works
                </Button>
              </a>
            </div>

            <p className="mt-6 text-[13.5px] text-fg-subtle">
              Joins Google Meet as a visible guest, with a name and a face.
              Nobody in the room has to wonder whether it is there.
            </p>
          </div>

          <div className="rise" style={{ animationDelay: "120ms" }}>
            <WorldMap />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- console --
          Sits directly under the hero on purpose: the console is the only thing
          here a competitor's landing page cannot show. */}
      <section className="border-t border-border bg-bg-subtle">
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

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/app/meetings/s_htn_sponsor_01">
              <Button variant="primary" size="lg">
                Watch a full meeting replay
                <Arrow width={16} height={16} />
              </Button>
            </Link>
            <p className="text-[13.5px] text-fg-subtle">
              Replayed end to end, with every gate decision shown as it lands.
            </p>
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

      {/* ------------------------------------------------------------ gate -- */}
      <section id="gate" className="border-t border-border bg-bg-subtle">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
            <h2 className="max-w-[18ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-balance">
              The hard part is staying quiet.
            </h2>
            <p className="mt-5 max-w-[58ch] text-[17px] leading-relaxed text-fg-muted">
              An AI that talks in every meeting gets muted in the first one. So
              the primitive underneath plus1 is not a better transcriber — it is
              a <em>gate</em>: a classifier that runs on every single utterance
              and decides, inside a 200 millisecond budget, whether to ignore
              it, answer it, or act on it.
            </p>
            <p className="mt-4 max-w-[58ch] text-[17px] leading-relaxed text-fg-muted">
              In a real meeting the gate says <em>ignore</em> to almost
              everything, and that is the feature. The demo replaying in our
              console is a compressed highlight reel, so its ratio is
              deliberately unrepresentative — what it shows is that every single
              line gets a verdict, on the record, where you can argue with it.
            </p>

            <div className="mt-9 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-7">
              <div>
                <p className="tnum text-[26px] font-medium tracking-[-0.03em] text-fg">
                  {gated.length}
                </p>
                <p className="mt-0.5 text-[13.5px] text-fg-muted">
                  lines, every one classified
                </p>
              </div>
              <div>
                <p className="tnum text-[26px] font-medium tracking-[-0.03em] text-fg-subtle">
                  {gated.length - acted}
                </p>
                <p className="mt-0.5 text-[13.5px] text-fg-muted">
                  dropped at the gate
                </p>
              </div>
              <div>
                <p
                  className="tnum text-[26px] font-medium tracking-[-0.03em]"
                  style={{ color: "var(--act)" }}
                >
                  {acted}
                </p>
                <p className="mt-0.5 text-[13.5px] text-fg-muted">
                  answered or acted on
                </p>
              </div>
              <div>
                <p className="tnum text-[26px] font-medium tracking-[-0.03em] text-fg">
                  &lt;200ms
                </p>
                <p className="mt-0.5 text-[13.5px] text-fg-muted">
                  budget per verdict
                </p>
              </div>
            </div>
            <p className="mt-4 max-w-[58ch] text-[12.5px] leading-snug text-fg-subtle">
              The counts are read out of the sample meeting at build time. The
              latency is the budget the gate is being designed to, not a
              measurement — the classifier is still being built, and we would
              rather tell you that than quote you a number from a sample.
            </p>

            <div className="overflow-hidden rounded-[var(--r-lg)] border border-border">
              <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-4 py-2.5">
                <span className="eyebrow">Heard</span>
                <span className="eyebrow">Verdict</span>
              </div>
              {gated.slice(0, 9).map((e) => {
                const gm = INTENT_META[e.intent];
                return (
                  <div
                    key={e.id}
                    className="flex items-start gap-4 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-fg-subtle">
                        {e.speaker}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-fg-muted">
                        {e.text}
                      </p>
                    </div>
                    <span className="chip shrink-0" style={{ color: gm.color }}>
                      {gm.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- capabilities -- */}
      <section id="capabilities" className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <h2 className="max-w-[22ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-balance">
            Six things it does while you are still talking.
          </h2>

          <div className="mt-14 border-t border-border">
            {CAPABILITIES.map((c) => (
              <div
                key={c.title}
                className="grid grid-cols-1 gap-x-10 gap-y-3 border-b border-border py-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
              >
                <div>
                  <h3 className="text-[19px] font-medium tracking-[-0.025em] text-fg">
                    {c.title}
                  </h3>
                  <p className="mt-1.5 text-[13.5px] font-medium text-fg">
                    {c.fixes}
                  </p>
                </div>
                <p className="max-w-[64ch] text-[15.5px] leading-relaxed text-fg-muted">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- limits -- */}
      <section id="limits" className="border-t border-border bg-bg-subtle">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
            <h2 className="max-w-[18ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-balance">
              What it will never do.
            </h2>
            <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-fg-muted">
              An agent that acts inside a live meeting is only usable if its
              limits are boring and absolute. These are in the agent, not in a
              settings screen, and no persona can turn them off.
            </p>

            <ul className="border-t border-border">
              {LIMITS.map((l) => (
                <li
                  key={l}
                  className="flex items-start gap-3.5 border-b border-border py-5 text-[15.5px] leading-relaxed text-fg"
                >
                  <span
                    className="dot mt-[9px]"
                    style={{ color: "var(--fg-subtle)" }}
                  />
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- cta -- */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="max-w-[16ch] text-[clamp(1.875rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-balance">
                Send a goose to your next meeting.
              </h2>
              <p className="mt-4 max-w-[52ch] text-[16.5px] leading-relaxed text-fg-muted">
                Paste a Meet link, pick what it is there to do, and let it in.
                It is unmistakably artificial, and that is the point.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Link href="/app">
                <Button variant="primary" size="lg">
                  Open the console
                  <Arrow width={16} height={16} />
                </Button>
              </Link>
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
              <GooseMark size={15} className="text-fg-subtle" />
              Honk.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
