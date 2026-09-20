"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, cx } from "@/components/ui";
import { Arrow, Link as LinkIcon, Alert } from "@/components/icons";
import { joinMeeting } from "@/lib/session";

const MEET_RE =
  /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i;

/**
 * The console's primary action, and the only thing on Home that starts work.
 * It is deliberately the single lifted surface on the page: one shadow, one
 * black button, everything else flat — so the eye lands here first.
 */
export function JoinMeeting() {
  const router = useRouter();
  const [url, setUrl] = useState("https://meet.google.com/vhz-nzug-ich");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();

    if (!trimmed) {
      setError("Paste the Google Meet link for the call you want to join.");
      return;
    }
    if (!MEET_RE.test(trimmed)) {
      setError(
        "That does not look like a Meet link. Expected meet.google.com/abc-defg-hij.",
      );
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const sessionId = await joinMeeting(trimmed, purpose.trim());
      router.push(`/app/meetings/${sessionId}`);
    } catch (err) {
      setError(
        `Could not reach the agent — is it running on :8787? (${(err as Error).message})`,
      );
      setBusy(false);
    }
  }

  return (
    <section className="rise rounded-[var(--r-lg)] border border-border bg-bg shadow-[var(--shadow-key)]">
      <form onSubmit={submit} className="p-6 sm:p-7">
        <h2 className="text-[19px] font-semibold tracking-[-0.03em] text-fg">
          Send the goose into a call
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">
          It joins on camera, presents the work browser, transcribes the room,
          and answers when someone says its name.
        </p>

        <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0 lg:flex-[1.15]">
            <label
              htmlFor="meet-url"
              className="mb-1.5 block text-[13px] font-medium text-fg"
            >
              Meeting link
            </label>
            <div className="relative">
              <LinkIcon
                width={15}
                height={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
              />
              <Input
                id="meet-url"
                value={url}
                disabled={busy}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="https://meet.google.com/abc-defg-hij"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "meet-url-error" : undefined}
                className={cx(
                  "h-11 pl-9 text-[14.5px] disabled:opacity-50",
                  error && "border-[var(--alert)]",
                )}
              />
            </div>
          </div>

          <div className="min-w-0 lg:flex-1">
            <label
              htmlFor="meet-purpose"
              className="mb-1.5 block text-[13px] font-medium text-fg"
            >
              What it is for{" "}
              <span className="font-normal text-fg-subtle">· optional</span>
            </label>
            <Input
              id="meet-purpose"
              value={purpose}
              disabled={busy}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Tampa warehouse submission review"
              maxLength={120}
              autoComplete="off"
              className="h-11 text-[14.5px] disabled:opacity-50"
            />
          </div>

          <div
            className="relative w-full lg:mt-[25px] lg:w-auto"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <div
              className="pointer-events-none absolute bottom-full right-0 z-50"
              style={{
                opacity: hovered ? 1 : 0,
                transform: hovered ? "translateY(0) scale(1)" : "translateY(8px) scale(0.96)",
                transition: "opacity 0.18s ease, transform 0.18s cubic-bezier(0.16,1,0.3,1)",
              }}
            >
              <img src="/join-call.png" alt="" width={30} height={20} className="h-auto w-[30px]" />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={busy}
              className="w-full"
            >
              {busy ? "Sending…" : "Send the goose"}
              {!busy && <Arrow width={16} height={16} />}
            </Button>
          </div>
        </div>

        {error ? (
          <p
            id="meet-url-error"
            role="alert"
            className="mt-3 flex items-start gap-1.5 text-[13px] leading-snug"
            style={{ color: "var(--alert)" }}
          >
            <Alert width={14} height={14} className="mt-[2px] shrink-0" />
            {error}
          </p>
        ) : (
          <p className="mt-3.5 text-[12.5px] leading-snug text-fg-subtle">
            Naming the meeting labels it everywhere in the console. Leave it
            blank and the first thing said becomes the label.
          </p>
        )}

        <p className="mt-3 text-[12.5px] leading-snug text-fg-subtle">
          The goose joins as a visible guest in a local Chrome window, then
          transcribes the room with Gemini. Lines stream in below as people
          speak.
        </p>
      </form>
    </section>
  );
}
