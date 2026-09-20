"use client";

import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus1Mark, cx } from "@/components/ui";
import { Arrow, Link as LinkIcon, Alert, Plus, Mic, PageMark, Caption, Console } from "@/components/icons";
import { joinMeeting } from "@/lib/session";

const MEET_RE = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i;

function greetingFor(h: number): string {
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** The three things plus1 does, in the room, in order — the whole pitch in one line. */
const CAPS: { Icon: (p: { width?: number; height?: number; className?: string }) => ReactElement; label: string }[] = [
  { Icon: Caption, label: "Listens live" },
  { Icon: PageMark, label: "Takes the notes" },
  { Icon: Console, label: "Screenshares & drives the browser" },
  { Icon: Mic, label: "Speaks up when addressed" },
];

/**
 * Home. The greeting, the pitch, and the one action a judge should understand in
 * three seconds — paste a link, send plus1 in — all in a single centered hero.
 * The optional name / work task hide behind a disclosure so the default is clean.
 */
export function HomeHero() {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const [url, setUrl] = useState("");
  const [purpose, setPurpose] = useState("");
  const [task, setTask] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const eyebrow = now ? `${greetingFor(now.getHours())} · ${fmtDate(now)}` : "Welcome back";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!MEET_RE.test(trimmed)) {
      setError("That doesn’t look like a Meet link — expected meet.google.com/abc-defg-hij.");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const sessionId = await joinMeeting(trimmed, purpose.trim(), task.trim());
      router.push(`/app/meetings/${sessionId}`);
    } catch (err) {
      setError(`Couldn’t reach the agent — is it running on :8787? (${(err as Error).message})`);
      setBusy(false);
    }
  }

  return (
    <header className="warm-hero grain page-enter relative shrink-0 overflow-hidden border-b border-border px-5 py-14 sm:px-7 sm:py-20 lg:px-9">
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center text-center">
        <span className="plus1-halo mb-6">
          <Plus1Mark size={56} className="sway text-fg" />
        </span>

        <p className="text-[13px] font-medium tracking-[-0.01em] text-fg-muted">{eyebrow}</p>

        <h1 className="mt-3 text-[34px] font-semibold leading-[1.03] tracking-[-0.045em] text-fg sm:text-[46px]">
          Your +1 in every meeting.
        </h1>
        <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-fg-muted sm:text-[17px]">
          plus1 joins on camera, listens to the room, takes the notes, and shares its screen to
          get the work done — while you stay in the conversation.
        </p>

        {/* the one action: paste a link, send it in */}
        <form onSubmit={submit} className="mt-8 w-full max-w-[600px]">
          <div
            className={cx(
              "flex h-16 items-center gap-2 rounded-full border bg-bg pl-5 pr-2 shadow-[var(--shadow-key)] transition-colors",
              error ? "border-[var(--alert)]" : "border-border",
            )}
          >
            <LinkIcon width={18} height={18} className="shrink-0 text-fg-subtle" />
            <input
              ref={inputRef}
              value={url}
              disabled={busy}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Paste a Google Meet link…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Google Meet link"
              aria-invalid={Boolean(error)}
              className="min-w-0 flex-1 bg-transparent text-[15.5px] text-fg outline-none focus:outline-none focus-visible:outline-none placeholder:text-fg-subtle disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy}
              aria-label="Send plus1 into the call"
              className={cx(
                "flex h-12 shrink-0 items-center gap-2 rounded-full bg-inverse-bg px-5 text-[14.5px] font-medium text-inverse-fg",
                "shadow-[var(--shadow-sm)] transition-[background-color,opacity] duration-150",
                "hover:bg-[var(--inverse-bg-hover)] disabled:opacity-45",
              )}
            >
              {busy ? "Sending…" : "Send plus1"}
              {!busy && <Arrow width={16} height={16} />}
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-3 flex items-center justify-center gap-1.5 text-[13px]" style={{ color: "var(--alert)" }}>
              <Alert width={14} height={14} className="shrink-0" />
              {error}
            </p>
          ) : (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {CAPS.map((c) => (
                <span key={c.label} className="flex items-center gap-1.5 text-[13px] text-fg-muted">
                  <c.Icon width={15} height={15} className="text-fg-subtle" />
                  {c.label}
                </span>
              ))}
            </div>
          )}

          {/* optional detail, tucked away so the default stays a single decision */}
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-expanded={more}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-fg-muted transition-colors hover:bg-bg-raise hover:text-fg"
            >
              <Plus
                width={14}
                height={14}
                className="transition-transform duration-200"
                style={{ transform: more ? "rotate(45deg)" : "none" }}
              />
              Name it or give it a task
            </button>

            {more && (
              <div className="rise-in mx-auto mt-3 grid max-w-[600px] gap-3 text-left sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[12.5px] font-medium text-fg">Meeting name</span>
                  <input
                    value={purpose}
                    disabled={busy}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="Tampa warehouse submission review"
                    maxLength={120}
                    autoComplete="off"
                    className="h-10 w-full rounded-[var(--r-sm)] border border-border bg-bg px-3 text-[14px] text-fg outline-none transition-colors hover:border-border-strong focus:border-border-strong disabled:opacity-50"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12.5px] font-medium text-fg">
                    Work task <span className="font-normal text-fg-subtle">· optional</span>
                  </span>
                  <input
                    value={task}
                    disabled={busy}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="Pull up the Tampa account and screenshare it"
                    maxLength={240}
                    autoComplete="off"
                    className="h-10 w-full rounded-[var(--r-sm)] border border-border bg-bg px-3 text-[14px] text-fg outline-none transition-colors hover:border-border-strong focus:border-border-strong disabled:opacity-50"
                  />
                </label>
              </div>
            )}
          </div>
        </form>
      </div>
    </header>
  );
}
