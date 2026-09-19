"use client";

import { useState } from "react";
import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { Button, cx } from "@/components/ui";
import { Plus, Check } from "@/components/icons";
import {
  ACCENT_VAR,
  DEFAULT_PERSONA_ID,
  PERSONAS,
  POLICY_HELP,
  personaById,
  type Persona,
} from "@/lib/personas";
import type { Policy } from "@/lib/types";
import { meetingCountByPersona } from "@/lib/meetings";

const POLICIES: Policy[] = ["Auto", "Ask", "Off"];

function PersonaRow({
  persona,
  selected,
  armed,
  onSelect,
}: {
  persona: Persona;
  selected: boolean;
  armed: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "flex w-full items-start gap-2.5 border-b border-border px-3.5 py-3 text-left transition-colors duration-150 last:border-b-0",
        selected ? "bg-bg-raise" : "hover:bg-bg-subtle",
      )}
    >
      <span className="dot mt-[7px]" style={{ color: ACCENT_VAR[persona.accent] }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-fg">{persona.name}</span>
          {armed && (
            <span className="chip" style={{ color: "var(--live)" }}>
              Armed
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">{persona.role}</span>
      </span>
      <span className="tnum mt-[3px] shrink-0 text-[12px] text-fg-subtle">
        {meetingCountByPersona(persona.id)}
      </span>
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border px-5 py-5">
      <div className="mb-2.5">
        <p className="text-[13px] font-medium text-fg">{label}</p>
        {hint && <p className="mt-0.5 max-w-[68ch] text-[12.5px] leading-snug text-fg-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export default function PersonasPage() {
  const [selectedId, setSelectedId] = useState(DEFAULT_PERSONA_ID);
  const [armedId, setArmedId] = useState(DEFAULT_PERSONA_ID);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [policies, setPolicies] = useState<Record<string, Record<string, Policy>>>({});

  const persona = personaById(selectedId);
  const accent = ACCENT_VAR[persona.accent];
  const prompt = drafts[persona.id] ?? persona.prompt;
  const dirty = prompt !== persona.prompt;

  const policyFor = (tool: string, fallback: Policy) =>
    policies[persona.id]?.[tool] ?? fallback;

  const setPolicy = (tool: string, policy: Policy) =>
    setPolicies((p) => ({ ...p, [persona.id]: { ...p[persona.id], [tool]: policy } }));

  return (
    <>
      <PageHeader
        title="Personas"
        description="A persona is the agent's standing brief for a meeting: what it is there to do, how freely it may speak, and which tools it may reach for. Pick one when you send the goose in."
        right={
          <Button variant="secondary">
            <Plus width={15} height={15} />
            New persona
          </Button>
        }
      />

      <PageBody>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* list */}
          <div className="h-fit overflow-hidden rounded-[var(--r)] border border-border">
            <div className="border-b border-border bg-bg-subtle px-3.5 py-2.5">
              <span className="eyebrow">Persona · meetings</span>
            </div>
            {PERSONAS.map((p) => (
              <PersonaRow
                key={p.id}
                persona={p}
                selected={p.id === selectedId}
                armed={p.id === armedId}
                onSelect={() => setSelectedId(p.id)}
              />
            ))}
          </div>

          {/* detail */}
          <div className="overflow-hidden rounded-[var(--r)] border border-border">
            <div className="flex flex-col gap-4 bg-bg-subtle px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="dot" style={{ color: accent }} />
                  <h2 className="text-[17px] font-semibold tracking-[-0.025em] text-fg">
                    {persona.name}
                  </h2>
                  <span className="text-[13px] text-fg-subtle">{persona.role}</span>
                </div>
                <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-fg-muted">
                  {persona.purpose}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {persona.tone.map((t) => (
                    <span
                      key={t}
                      className="rounded-[var(--r-sm)] border border-border bg-bg px-2 py-0.5 text-[12px] text-fg-muted"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <Button
                variant={armedId === persona.id ? "secondary" : "primary"}
                onClick={() => setArmedId(persona.id)}
                disabled={armedId === persona.id}
                className="shrink-0"
              >
                {armedId === persona.id ? (
                  <>
                    <Check width={15} height={15} />
                    Armed
                  </>
                ) : (
                  "Arm for next meeting"
                )}
              </Button>
            </div>

            <Field
              label="Standing brief"
              hint="Handed to the brain at the start of every meeting this persona joins. Write it the way you would brief a new hire on their first call."
            >
              <textarea
                value={prompt}
                onChange={(e) => setDrafts((d) => ({ ...d, [persona.id]: e.target.value }))}
                rows={7}
                spellCheck={false}
                className={cx(
                  "w-full resize-y rounded-[var(--r-sm)] border border-border bg-bg p-3",
                  "text-[13.5px] leading-relaxed text-fg transition-colors duration-150",
                  "hover:border-border-strong focus:border-border-strong focus:outline-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--ring)]",
                )}
              />
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <p className="tnum text-[12px] text-fg-subtle">{prompt.length} characters</p>
                <div className="flex items-center gap-2">
                  {dirty && (
                    <button
                      onClick={() => setDrafts((d) => ({ ...d, [persona.id]: persona.prompt }))}
                      className="text-[12.5px] font-medium text-fg-muted transition-colors hover:text-fg"
                    >
                      Revert
                    </button>
                  )}
                  <Button size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty}>
                    {dirty ? "Save brief" : "Saved"}
                  </Button>
                </div>
              </div>
            </Field>

            <Field
              label="Speaking rules"
              hint="The gate runs on every utterance. These set how sure it must be before the goose opens its beak."
            >
              <div className="flex flex-col gap-4">
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="threshold" className="text-[13px] text-fg-muted">
                      Answers above
                    </label>
                    <span className="tnum text-[13px] font-medium" style={{ color: accent }}>
                      {persona.gate.speakThreshold >= 1
                        ? "never speaks"
                        : `${Math.round(persona.gate.speakThreshold * 100)}% confidence`}
                    </span>
                  </div>
                  <div className="meter mt-2" style={{ color: accent }}>
                    <i style={{ ["--fill" as string]: persona.gate.speakThreshold }} />
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-fg-subtle">
                    Below this it says it is unsure and asks, rather than guessing.
                  </p>
                </div>

                <div className="flex flex-col gap-2 border-t border-border pt-4">
                  {[
                    {
                      on: persona.gate.honkOnDisagreement,
                      label: "Honk when two people contradict each other",
                    },
                    {
                      on: persona.gate.monologueMinutes > 0,
                      label:
                        persona.gate.monologueMinutes > 0
                          ? `Honk after one person holds the floor for ${persona.gate.monologueMinutes} minutes`
                          : "Honk at long monologues",
                    },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center gap-2.5">
                      <span
                        className="dot"
                        style={{ color: r.on ? "var(--alert)" : "var(--border-strong)" }}
                      />
                      <span className={cx("text-[13px]", r.on ? "text-fg" : "text-fg-subtle")}>
                        {r.label}
                      </span>
                      <span
                        className="ml-auto text-[12px] font-medium"
                        style={{ color: r.on ? "var(--alert)" : "var(--fg-subtle)" }}
                      >
                        {r.on ? "On" : "Off"}
                      </span>
                    </div>
                  ))}
                  <p className="mt-1 text-[12.5px] text-fg-subtle">
                    <code className="tnum rounded bg-bg-raise px-1 py-0.5 text-fg-muted">/honk</code>{" "}
                    in meeting chat always works, on every persona.
                  </p>
                </div>
              </div>
            </Field>

            <Field
              label="Tool policy"
              hint="Set per tool. Irreversible actions still need a spoken yes, whatever this says."
            >
              <div className="overflow-hidden rounded-[var(--r-sm)] border border-border">
                {persona.tools.map((t) => {
                  const current = policyFor(t.name, t.policy);
                  return (
                    <div
                      key={t.name}
                      className="flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-fg">{t.name}</p>
                        <p className="mt-0.5 text-[12.5px] text-fg-muted">{POLICY_HELP[current]}</p>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label={`${t.name} policy`}
                        className="flex shrink-0 rounded-[var(--r-sm)] border border-border p-0.5"
                      >
                        {POLICIES.map((p) => (
                          <button
                            key={p}
                            role="radio"
                            aria-checked={current === p}
                            onClick={() => setPolicy(t.name, p)}
                            className={cx(
                              "h-7 rounded-[4px] px-2.5 text-[12.5px] font-medium transition-colors duration-150",
                              current === p
                                ? "bg-bg-raise text-fg"
                                : "text-fg-subtle hover:text-fg-muted",
                            )}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      </PageBody>
    </>
  );
}
