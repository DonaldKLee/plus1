"use client";

import { useState } from "react";
import { Check } from "./icons";

function honk() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.34);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable */
  }
}

const VOICES = [
  { id: "reginald", name: "Reginald", desc: "house voice · dry, slightly-too-formal" },
  { id: "bramble", name: "Bramble", desc: "warmer · eager intern energy" },
  { id: "pennington", name: "Pennington", desc: "clipped · senior partner" },
  { id: "undersec", name: "The Undersecretary", desc: "gravelly · unbothered" },
];

const GUARDRAILS = [
  { id: "deadlines", text: "Never commit to deadlines on my behalf", on: true },
  { id: "comp", text: "Never discuss compensation or salary", on: true },
  { id: "send", text: "Never send, publish, or delete without a spoken yes", on: true },
  { id: "legal", text: "Never agree to contract terms", on: false },
  { id: "numbers", text: "Flag any figure it isn't sure about", on: true },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-[3px] border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-[color-mix(in_srgb,var(--color-act)_55%,transparent)]";

export function Setup() {
  const [name, setName] = useState("Reginald");
  const [persona, setPersona] = useState(28);
  const [notes, setNotes] = useState(
    "Keep answers to one or two sentences. Lowercase. Cite the source when it matters. If you're under 60% sure, say so and ask.",
  );
  const [voice, setVoice] = useState("reginald");
  const [guards, setGuards] = useState(GUARDRAILS);

  const personaLabel =
    persona < 33 ? "deferential intern" : persona < 66 ? "steady operator" : "smug consultant";

  return (
    <section className="panel reticle min-h-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-6 py-3 backdrop-blur">
        <div>
          <h1 className="font-display text-[17px] font-700 tracking-tight text-ink">Persona</h1>
          <p className="data text-[10px] text-ink-3">how the goose behaves in the room</p>
        </div>
        <span className="chip !py-1" style={{ color: "var(--color-live)" }}>
          <span className="led" style={{ color: "var(--color-live)" }} /> saved
        </span>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-6 py-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Goose name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Display name in Meet">
            <div className={`${inputCls} data flex items-center text-ink-2`}>🦆 {name} (AI)</div>
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label">Personality</span>
            <span className="data text-[11px]" style={{ color: "var(--color-act)" }}>
              {personaLabel}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={persona}
            onChange={(e) => setPersona(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
            style={{
              background: `linear-gradient(90deg, var(--color-act) ${persona}%, var(--color-line) ${persona}%)`,
            }}
          />
          <div className="mt-1.5 flex justify-between">
            <span className="data text-[10px] text-ink-3">deferential intern</span>
            <span className="data text-[10px] text-ink-3">smug consultant</span>
          </div>
        </div>

        <Field label="Behavior notes">
          <textarea
            className={`${inputCls} min-h-[92px] resize-y leading-relaxed`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {/* guardrails */}
        <div>
          <span className="label mb-2.5 block">Guardrails</span>
          <div className="space-y-1.5">
            {guards.map((g) => (
              <button
                key={g.id}
                onClick={() =>
                  setGuards((gs) => gs.map((x) => (x.id === g.id ? { ...x, on: !x.on } : x)))
                }
                className="flex w-full items-center gap-3 rounded-[3px] border border-line bg-panel-2 px-3 py-2.5 text-left transition-colors hover:border-line-2"
              >
                <span
                  className="flex h-4.5 w-4.5 items-center justify-center rounded-[3px] border transition-colors"
                  style={{
                    width: 18,
                    height: 18,
                    color: g.on ? "var(--color-bg)" : "transparent",
                    background: g.on ? "var(--color-live)" : "transparent",
                    borderColor: g.on ? "var(--color-live)" : "var(--color-line-2)",
                  }}
                >
                  <Check width={12} height={12} />
                </span>
                <span className={`text-[13px] ${g.on ? "text-ink" : "text-ink-3"}`}>{g.text}</span>
              </button>
            ))}
          </div>
        </div>

        {/* voice */}
        <div>
          <span className="label mb-2.5 block">Voice</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {VOICES.map((v) => {
              const active = voice === v.id;
              return (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-[3px] border bg-panel-2 px-3 py-2.5 transition-colors"
                  style={{
                    borderColor: active ? "color-mix(in srgb, var(--color-act) 45%, transparent)" : "var(--color-line)",
                    background: active ? "color-mix(in srgb, var(--color-act) 7%, transparent)" : undefined,
                  }}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => setVoice(v.id)}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border"
                        style={{
                          borderColor: active ? "var(--color-act)" : "var(--color-line-2)",
                          background: active ? "var(--color-act)" : "transparent",
                          boxShadow: active ? "inset 0 0 0 2px var(--color-panel-2)" : "none",
                        }}
                      />
                      <span className="text-[13px] font-600 text-ink">{v.name}</span>
                    </div>
                    <p className="data mt-0.5 pl-5 text-[10.5px] text-ink-3">{v.desc}</p>
                  </button>
                  <button
                    onClick={honk}
                    title="preview (honk)"
                    className="shrink-0 rounded-[3px] border border-line px-2.5 py-1 text-[10px] font-600 text-ink-2 transition-colors hover:border-line-2 hover:text-act"
                  >
                    honk
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
