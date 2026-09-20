"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelHead, Input, Plus1Mark, Chip, Dot, cx } from "@/components/ui";
import { Plug, Check, Plus } from "@/components/icons";
import {
  activeSessionId,
  fetchplus1Config,
  saveplus1Config,
  updateSessionConfig,
} from "@/lib/session";
import {
  type AccessLevel,
  type Config,
  DEFAULT_CONFIG,
  GUARDRAILS,
  loadConfig,
  normalize,
  SERVERS,
  STORAGE_KEY,
  ToolTile,
  broadcastConfig,
} from "@/lib/plus1";

/* ------------------------------------------------------------ controls ---- */

function Toggle({ on, onChange, label }: { on: boolean; onChange: (n: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]",
        on ? "border-transparent bg-inverse-bg" : "border-border-strong bg-bg-inset",
      )}
    >
      <span
        className={cx(
          "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left] duration-150",
          on ? "left-[18px] bg-inverse-fg" : "left-[2px] bg-bg",
        )}
        style={on ? undefined : { boxShadow: "0 0 0 1px var(--border-strong)" }}
      />
    </button>
  );
}

function Slider({
  value,
  min = 0,
  max = 100,
  onChange,
  left,
  right,
  ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (n: number) => void;
  left: string;
  right: string;
  ariaLabel: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--pct" as string]: `${pct}%` }}
      />
      <div className="mt-1 flex justify-between">
        <span className="text-[11.5px] text-fg-subtle">{left}</span>
        <span className="text-[11.5px] text-fg-subtle">{right}</span>
      </div>
    </div>
  );
}

function Stepper({ value, min, max, onChange, unit }: { value: number; min: number; max: number; onChange: (n: number) => void; unit: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-[var(--r-sm)] border border-border bg-bg p-[2px]">
      <button
        type="button"
        aria-label="decrease"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex h-6 w-6 items-center justify-center rounded-[4px] text-fg-muted transition-colors hover:bg-bg-raise hover:text-fg disabled:opacity-30"
        disabled={value <= min}
      >
        –
      </button>
      <span className="tnum min-w-[54px] text-center text-[12.5px] font-medium text-fg">
        {value} {unit}
      </span>
      <button
        type="button"
        aria-label="increase"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-6 w-6 items-center justify-center rounded-[4px] text-fg-muted transition-colors hover:bg-bg-raise hover:text-fg disabled:opacity-30"
        disabled={value >= max}
      >
        <Plus width={13} height={13} />
      </button>
    </div>
  );
}

function Segmented({ value, onChange }: { value: AccessLevel; onChange: (n: AccessLevel) => void }) {
  const opts: { id: AccessLevel; label: string }[] = [
    { id: "read", label: "Read only" },
    { id: "write", label: "Read & write" },
  ];
  return (
    <div className="inline-flex rounded-[var(--r-sm)] border border-border bg-bg p-[2px]">
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cx(
              "rounded-[4px] px-2.5 py-1 text-[12px] font-medium tracking-[-0.01em] transition-colors duration-150",
              active ? "bg-bg-raise text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- summary ---- */

function autonomyWord(v: number) {
  if (v < 34) return "Notetaker";
  if (v < 67) return "Balanced";
  return "Action taker";
}

function behaviorSentence(c: Config): string {
  const name = c.name.trim() || "The plus1";
  const stance =
    c.autonomy < 34
      ? "mostly listens and takes notes, speaking only when addressed"
      : c.autonomy < 67
        ? "answers when asked and offers to help with the work"
        : "jumps in, drafts, and does the work as the meeting runs";
  const care = `asks before acting when it's under ${c.confidence}% sure`;
  const honk = c.honk ? `, and chimes in on disagreement or a monologue past ${c.monologueMin} min` : "";
  return `${name} ${stance}. It ${care}${honk}.`;
}

/* -------------------------------------------------------------- screen ---- */

export function Plus1Config() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [live, setLive] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPersist = useRef(true);

  const [remote, setRemote] = useState(false);

  useEffect(() => {
    let alive = true;
    // Paint this browser's cached copy immediately, then let MongoDB win.
    setConfig(loadConfig());
    (async () => {
      const stored = await fetchplus1Config();
      if (alive && stored) {
        setConfig(normalize(stored as Partial<Config>));
        setRemote(true);
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    // the hydration-triggered run isn't a user edit — don't flash "Saved"
    if (firstPersist.current) {
      firstPersist.current = false;
      return;
    }
    try {
      // Local copy is the cache; MongoDB is the record.
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* storage unavailable — the tab still works for this session */
    }
    // Tell the rail (and any other mounted surface) immediately, so an enabled
    // tool appears there the moment it's toggled — no reload, no round-trip.
    broadcastConfig(config);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveplus1Config(config as unknown as Record<string, unknown>).then((ok) => {
        setRemote(ok);
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1500);
      });
    }, 400);
    // If a meeting is live, push the change to it (debounced), so settings tune
    // the plus1 mid-meeting — no rejoin needed.
    const sid = activeSessionId();
    if (sid) {
      if (liveTimer.current) clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(() => {
        void updateSessionConfig(sid, {
          name: config.name,
          persona: config.persona,
          autonomy: config.autonomy,
          confidence: config.confidence,
          guardrails: config.guardrails,
          servers: config.servers,
          localAccess: config.localAccess,
        }).then((ok) => {
          if (!ok) return;
          setLive(true);
          setTimeout(() => setLive(false), 1800);
        });
      }, 500);
    }
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, [config, ready]);

  const displayName = config.name.trim() || "the plus1";
  const enabledCount = Object.values(config.servers).filter(Boolean).length;
  const guardCount = Object.values(config.guardrails).filter(Boolean).length;
  const sentence = useMemo(() => behaviorSentence(config), [config]);

  const set = <K extends keyof Config>(key: K, val: Config[K]) =>
    setConfig((c) => ({ ...c, [key]: val }));

  return (
    <div className="flex flex-col gap-6">
      {(saved || live) && (
        <div className="rise-in fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-[var(--r-sm)] border border-border bg-bg-subtle px-3 py-2 text-[12.5px] text-fg-muted shadow-[var(--shadow-lg)]">
          <Dot color="var(--live)" pulse={live} />
          {live ? "Applied to live meeting" : remote ? "Saved to MongoDB" : "Saved in this browser"}
        </div>
      )}

      {/* live behaviour summary — reads the whole config back in plain English */}
      <div className="warm-card grain relative flex items-start gap-3.5 overflow-hidden rounded-[var(--r)] border border-border p-4">
        <span className="plus1-halo mt-0.5 shrink-0">
          <Plus1Mark size={28} className="text-fg" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] leading-relaxed text-fg">{sentence}</p>
        </div>
      </div>

      {/* ---- identity ---- */}
      <Panel>
        <PanelHead title="Identity" />
        <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-start">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Name</span>
            <Input
              value={config.name}
              maxLength={40}
              spellCheck={false}
              placeholder="Bob"
              onChange={(e) => set("name", e.target.value)}
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
              What the plus1 is called, out loud and in the meeting chat.
            </p>
          </label>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-fg">In the call</span>
            <div className="flex items-center gap-2.5 rounded-[var(--r-sm)] border border-border bg-bg px-3 py-2.5">
              <Plus1Mark size={22} className="shrink-0 text-fg" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">{displayName}</span>
              <Chip color="var(--act)">AI</Chip>
            </div>
          </div>
        </div>

        {/* persona / instructions */}
        <div className="border-t border-border px-5 py-5">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Persona &amp; instructions</span>
            <textarea
              value={config.persona}
              rows={5}
              spellCheck
              placeholder="Describe how it should act — personality, tone, any context or rules. e.g. “You're a calm, no-nonsense broker. Be concise. We only write personal auto and tenant in Ontario. Always mention bundling.”"
              onChange={(e) => set("persona", e.target.value)}
              className={cx(
                "w-full resize-y rounded-[var(--r-sm)] border border-border bg-bg px-3 py-2.5 text-[14px] leading-relaxed text-fg",
                "transition-colors duration-150 hover:border-border-strong",
                "focus:border-border-strong focus:outline-none",
                "focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--ring)]",
              )}
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
              This is fed straight into the model — it shapes how {displayName} talks and acts in
              meetings and chat. Personality, tone, house rules, or context all work.
            </p>
          </label>
        </div>
      </Panel>

      {/* ---- behaviour ---- */}
      <Panel>
        <PanelHead title="Behavior" />
        <div className="flex flex-col gap-7 p-5">
          {/* autonomy */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-fg">Autonomy</span>
              <Chip>{autonomyWord(config.autonomy)}</Chip>
            </div>
            <Slider
              value={config.autonomy}
              onChange={(n) => set("autonomy", n)}
              left="Notetaker"
              right="Action taker"
              ariaLabel="Autonomy"
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
              How far the plus1 goes on its own: From quietly capturing the meeting to drafting emails
              and running tools as the conversation happens.
            </p>
          </div>

          {/* confidence threshold */}
          <div className="border-t border-border pt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-medium text-fg">Confidence threshold</span>
              <span className="tnum text-[14px] font-medium text-fg">{config.confidence}%</span>
            </div>
            <Slider
              value={config.confidence}
              onChange={(n) => set("confidence", n)}
              left="Bolder · guesses more"
              right="Careful · asks more"
              ariaLabel="Confidence threshold"
            />
            <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
              Below this, the plus1 says it isn&rsquo;t sure and asks instead of answering.
            </p>
          </div>

          {/* honk */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
            <div className="min-w-0">
              <span className="text-[13px] font-medium text-fg">Challenge</span>
              <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-fg-muted">
                The plus1 chimes in on disagreement, on a long monologue, and any time someone types
                <span className="tnum"> /challenge</span> in the chat.
              </p>
            </div>
            <div className="flex items-center gap-4">
              {config.honk && (
                <div className="rise-in flex items-center gap-2">
                  <span className="text-[12.5px] text-fg-muted">after</span>
                  <Stepper value={config.monologueMin} min={1} max={10} unit="min" onChange={(n) => set("monologueMin", n)} />
                </div>
              )}
              <Toggle on={config.honk} onChange={(n) => set("honk", n)} label="Honk" />
            </div>
          </div>
        </div>
      </Panel>

      {/* ---- guardrails ---- */}
      <Panel>
        <PanelHead
          title="Guardrails"
          right={
            <span className="tnum text-[12px] text-fg-subtle">
              {guardCount} of {GUARDRAILS.length} enforced
            </span>
          }
        />
        <div className="divide-y divide-border">
          {GUARDRAILS.map((g) => {
            const on = config.guardrails[g.id];
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => set("guardrails", { ...config.guardrails, [g.id]: !on })}
                aria-pressed={on}
                className="group flex w-full items-start gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-bg-subtle/60"
              >
                <span
                  className={cx(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-sm)] border transition-colors",
                    on ? "border-border-strong bg-bg text-fg" : "border-border bg-bg-subtle text-fg-subtle",
                  )}
                >
                  <g.Icon width={16} height={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block text-[13.5px] font-medium", on ? "text-fg" : "text-fg-muted")}>
                    {g.label}
                  </span>
                  <span className="mt-0.5 block max-w-[58ch] text-[12.5px] leading-relaxed text-fg-subtle">
                    {g.hint}
                  </span>
                </span>
                <span
                  className={cx(
                    "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                    on ? "border-transparent bg-inverse-bg text-inverse-fg" : "border-border-strong bg-bg text-transparent",
                  )}
                >
                  <Check width={12} height={12} />
                </span>
              </button>
            );
          })}
        </div>
        <p className="border-t border-border px-5 py-3 text-[12px] leading-relaxed text-fg-subtle">
          Guardrails are hard rules written into the plus1&rsquo;s prompt — they hold above its
          persona and apply in every meeting and chat.
        </p>
      </Panel>

      {/* ---- tools / MCP servers ---- */}
      <Panel>
        <PanelHead
          title="Tools"
          right={
            <span className="flex items-center gap-1.5 text-fg-subtle">
              <Plug width={14} height={14} />
              <span className="tnum text-[12px]">{enabledCount}/{SERVERS.length} on</span>
            </span>
          }
        />
        <div className="divide-y divide-border">
          {SERVERS.map((s) => {
            const on = config.servers[s.id];
            return (
              <div key={s.id} className="px-5 py-4">
                <div className="flex items-start gap-3.5">
                  <ToolTile tile={s.tile} on={on} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-fg">{s.name}</span>
                      <Chip color={on ? "var(--live)" : undefined} className={on ? undefined : "opacity-70"}>
                        <Dot color={on ? "var(--live)" : "var(--fg-subtle)"} pulse={on} />
                        {on ? "On" : "Off"}
                      </Chip>
                    </div>
                    <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-fg-muted">{s.summary}</p>
                    {s.id === "local" && on && (
                      <div className="rise-in mt-3 flex flex-wrap items-center gap-3">
                        <span className="text-[12.5px] font-medium text-fg-muted">Access</span>
                        <Segmented value={config.localAccess} onChange={(n) => set("localAccess", n)} />
                        <span className="text-[12px] text-fg-subtle">
                          {config.localAccess === "write"
                            ? "The plus1 can read and modify files."
                            : "The plus1 can read files but not change them."}
                        </span>
                      </div>
                    )}
                  </div>
                  <Toggle
                    on={on}
                    label={`Turn ${s.name} ${on ? "off" : "on"}`}
                    onChange={(n) => set("servers", { ...config.servers, [s.id]: n })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <p className="text-[12.5px] text-fg-subtle">
        {remote
          ? "Stored in MongoDB, so they follow the plus1 across browsers and restarts."
          : "Stored in this browser — set MONGODB_URI on the backend to keep them with the plus1."}{" "}
        These settings tell the plus1 how to behave and which tools it may use in a meeting.
      </p>
    </div>
  );
}
