"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, cx } from "@/components/ui";
import { Link as LinkIcon, Alert } from "@/components/icons";
import { PersonaSelect } from "./PersonaSelect";
import { ACCENT_VAR, DEFAULT_PERSONA_ID, personaById } from "@/lib/personas";

const MEET_RE =
  /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\?.*)?$/i;

type Phase = "idle" | "joining" | "joined";

export function JoinMeeting() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA_ID);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const persona = personaById(personaId);
  const accent = ACCENT_VAR[persona.accent];
  const busy = phase !== "idle";

  function submit(e: React.FormEvent) {
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
    setPhase("joining");
    // Stands in for POST /sessions. The runner is not wired up yet, so this
    // lands on the demo replay instead of a live session.
    window.setTimeout(() => setPhase("joined"), 1400);
    window.setTimeout(
      () => router.push("/app/meetings/s_htn_sponsor_01"),
      2400,
    );
  }

  return (
    <section className="rounded-[var(--r-lg)] border border-border bg-bg-subtle">
      <form onSubmit={submit} className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
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
                  "pl-9 disabled:opacity-50",
                  error && "border-[var(--alert)]",
                )}
              />
            </div>
          </div>

          <div className="w-full lg:w-[280px]">
            <label className="mb-1.5 block text-[13px] font-medium text-fg">
              Persona
            </label>
            <PersonaSelect value={personaId} onChange={setPersonaId} />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={busy}
            className="w-full lg:w-auto"
          >
            {phase === "idle" && "Send the goose"}
            {phase === "joining" && "Opening the demo…"}
            {phase === "joined" && "Opening the demo…"}
          </Button>
        </div>

        {error && (
          <p
            id="meet-url-error"
            role="alert"
            className="mt-3 flex items-start gap-1.5 text-[13px] leading-snug"
            style={{ color: "var(--alert)" }}
          >
            <Alert width={14} height={14} className="mt-[2px] shrink-0" />
            {error}
          </p>
        )}

        <p className="mt-3 text-[12.5px] leading-snug text-fg-subtle">
          Demo build — the runner is not wired up yet, so this does not join
          your room. Whatever you paste opens a recorded meeting so you can
          watch the gate work end to end.
        </p>
      </form>

      <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-start gap-2 text-[13px] leading-snug text-fg-muted">
          <span className="dot mt-[6px]" style={{ color: accent }} />
          <span>
            <span className="font-medium text-fg">{persona.name}</span>{" "}
            {persona.purpose}
          </span>
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {persona.tools
            .filter((t) => t.policy !== "Off")
            .map((t) => (
              <span
                key={t.name}
                className="rounded-[var(--r-sm)] border border-border bg-bg px-2 py-0.5 text-[12px] text-fg-muted"
              >
                {t.name}
                <span className="ml-1.5 text-fg-subtle">{t.policy}</span>
              </span>
            ))}
        </div>
      </div>
    </section>
  );
}
