"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelHead, Input, Plus1Mark, Chip, Dot, Button, cx } from "@/components/ui";
import { Plug, Check, Plus } from "@/components/icons";
import {
  activeSessionId,
  fetchEmailStatus,
  fetchplus1Config,
  saveplus1Config,
  updateSessionConfig,
  type EmailStatus,
} from "@/lib/session";

/* --------------------------------------------------------------- model ---- */

type ServerId = "federato" | "intact" | "local" | "docs" | "email";
type AccessLevel = "read" | "write";

interface Config {
  name: string;
  voice: string;
  autonomy: number; // 0 = notetaker, 100 = action taker
  confidence: number; // 0..100 — below this it asks instead of guessing
  honk: boolean;
  monologueMin: number; // honk after N minutes of monologue
  guardrails: { sendApproval: boolean; noComp: boolean; noDeadlines: boolean };
  servers: Record<ServerId, boolean>;
  localAccess: AccessLevel;
  email: { allowlist: string; defaultTo: string };
}

const DEFAULT_CONFIG: Config = {
  name: "Shannon",
  voice: "reginald",
  autonomy: 45,
  confidence: 68,
  honk: true,
  monologueMin: 3,
  guardrails: { sendApproval: false, noComp: true, noDeadlines: false },
  // Documents are harmless (a PDF in memory); email leaves the building.
  servers: { federato: true, intact: true, local: false, docs: true, email: true },
  localAccess: "read",
  email: { allowlist: "", defaultTo: "" },
};

const STORAGE_KEY = "plus1.plus1.config";

/** Fill in anything a stored config is missing, whatever its source. */
function normalize(p: Partial<Config>): Config {
  return {
    ...DEFAULT_CONFIG,
    ...p,
    guardrails: { ...DEFAULT_CONFIG.guardrails, ...(p.guardrails ?? {}) },
    servers: { ...DEFAULT_CONFIG.servers, ...(p.servers ?? {}) },
    localAccess: p.localAccess === "write" ? "write" : "read",
    email: {
      ...DEFAULT_CONFIG.email,
      ...(typeof p.email === "object" && p.email ? p.email : {}),
    },
  };
}

/** This browser's cached copy — the instant paint, before MongoDB answers. */
function loadConfig(): Config {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return normalize(JSON.parse(raw) as Partial<Config>);
  } catch {
    return DEFAULT_CONFIG;
  }
}

const VOICES = [
  { id: "reginald", name: "Reginald", desc: "dry, slightly-too-formal" },
  { id: "bramble", name: "Bramble", desc: "warm, eager intern" },
  { id: "pennington", name: "Pennington", desc: "clipped, senior partner" },
  { id: "undersec", name: "Undersecretary", desc: "gravelly, unbothered" },
];

const SERVERS: { id: ServerId; name: string; monogram: string; summary: string }[] = [
  {
    id: "federato",
    name: "Federato",
    monogram: "F",
    summary:
      "Commercial property queue, appetite scoring, and Federato-branded indication PDFs from the live file.",
  },
  {
    id: "intact",
    name: "Intact",
    monogram: "I",
    summary:
      "Personal car and tenant quotes. Quote PDFs from this path say Intact, never Federato.",
  },
  {
    id: "local",
    name: "Local access",
    monogram: "L",
    summary: "Read and write files on this machine, scoped to the working directory.",
  },
  {
    id: "docs",
    name: "Documents",
    monogram: "D",
    summary:
      "Meeting notes and write-ups as PDFs. Quote PDFs still come from Federato or Intact so the masthead matches the source.",
  },
  {
    id: "email",
    name: "Email",
    monogram: "E",
    summary:
      "Send mail with the last PDF attached. SMTP credentials stay in .env; allowlist and a default recipient live here.",
  },
];

const GUARDRAILS: { id: keyof Config["guardrails"]; label: string }[] = [
  { id: "noComp", label: "Never discuss compensation or salary" },
  { id: "noDeadlines", label: "Never commit to deadlines on my behalf" },
];

/* ---------------------------------------------------------- honk synth ---- */

function playHonk() {
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
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable */
  }
}

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

function Checkbox({ on, onChange, label }: { on: boolean; onChange: (n: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-[var(--r-sm)] px-1 py-1.5 text-left transition-colors hover:bg-bg-raise/60"
    >
      <span
        className={cx(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
          on ? "border-transparent bg-inverse-bg text-inverse-fg" : "border-border-strong bg-bg text-transparent",
        )}
      >
        <Check width={12} height={12} />
      </span>
      <span className={cx("text-[13.5px]", on ? "text-fg" : "text-fg-muted")}>{label}</span>
    </button>
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

function parseEntries(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function AllowlistEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const entries = parseEntries(value);

  const add = (raw: string) => {
    const next = parseEntries(raw);
    if (!next.length) return;
    onChange([...new Set([...entries, ...next])].join(", "));
    setDraft("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {entries.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onChange(entries.filter((x) => x !== e).join(", "))}
            className="chip text-fg hover:border-border-strong"
            title={`Remove ${e}`}
          >
            <span className="tnum">{e}</span>
            <span className="text-fg-subtle">×</span>
          </button>
        ))}
      </div>
      <Input
        className="mt-2"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        placeholder="Add an address or domain — enter"
        aria-label="Add allowlist entry"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === " ") {
            e.preventDefault();
            add(draft);
          }
          if (e.key === "Backspace" && !draft && entries.length) {
            onChange(entries.slice(0, -1).join(", "));
          }
        }}
        onBlur={() => {
          if (draft.trim()) add(draft);
        }}
      />
    </div>
  );
}

function EmailSettings({
  config,
  onChange,
}: {
  config: Config;
  onChange: (email: Config["email"]) => void;
}) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchEmailStatus(false).then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function verify() {
    setChecking(true);
    const s = await fetchEmailStatus(true);
    setStatus(s);
    setChecking(false);
  }

  const sending = Boolean(status?.configured && !status.dryRun);
  const label = !status
    ? "Checking SMTP…"
    : sending
      ? `Sending as ${status.from ?? status.user} via ${status.host}`
      : status.configured
        ? `Configured as ${status.from ?? status.user}, currently drafting only`
        : "SMTP is not configured — drafts stay on this machine";

  return (
    <div className="rise-in mt-4 flex flex-col gap-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Chip color={sending ? "var(--live)" : "var(--think)"}>
            <Dot color={sending ? "var(--live)" : "var(--think)"} pulse={sending} />
            {sending ? "Live" : status?.configured ? "Draft only" : "Not connected"}
          </Chip>
          <span className="min-w-0 text-[12.5px] leading-relaxed text-fg-muted">{label}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void verify()} disabled={checking}>
          {checking ? "Checking…" : status?.verified === true ? "Verified" : "Check connection"}
        </Button>
      </div>
      {status?.error && <p className="text-[12.5px] leading-relaxed text-[var(--alert)]">{status.error}</p>}

      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-fg">Default recipient</span>
        <Input
          type="email"
          value={config.email.defaultTo}
          spellCheck={false}
          autoComplete="email"
          placeholder="you@company.com"
          onChange={(e) => onChange({ ...config.email, defaultTo: e.target.value })}
        />
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
          Used when someone says “email it” without naming an address.
        </p>
      </label>

      <div>
        <span className="mb-1.5 block text-[13px] font-medium text-fg">Allowlist</span>
        <AllowlistEditor
          value={config.email.allowlist}
          onChange={(allowlist) => onChange({ ...config.email, allowlist })}
        />
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-muted">
          Addresses or domains the plus1 may mail. Combined with EMAIL_ALLOWLIST in .env. Empty here
          means only that list — or anyone, if both are empty.
        </p>
      </div>
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
  const honk = c.honk ? `, and honks on disagreement or a monologue past ${c.monologueMin} min` : "";
  return `${name} ${stance} — it ${care}${honk}.`;
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
          autonomy: config.autonomy,
          confidence: config.confidence,
          guardrails: config.guardrails,
          servers: config.servers,
          localAccess: config.localAccess,
          email: config.email,
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
      <div className="flex items-start gap-3 rounded-[var(--r)] border border-border bg-bg-subtle p-4">
        <Plus1Mark size={26} className="mt-0.5 shrink-0 text-fg" />
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

        {/* voice */}
        <div className="border-t border-border px-5 py-5">
          <span className="mb-2.5 block text-[13px] font-medium text-fg">Voice</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {VOICES.map((v) => {
              const active = config.voice === v.id;
              return (
                <div
                  key={v.id}
                  className={cx(
                    "flex items-center gap-3 rounded-[var(--r-sm)] border px-3 py-2.5 transition-colors",
                    active ? "border-border-strong bg-bg-raise" : "border-border bg-bg hover:border-border-strong",
                  )}
                >
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => set("voice", v.id)}>
                    <span
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
                      style={{ borderColor: active ? "var(--fg)" : "var(--border-strong)" }}
                    >
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-fg" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-fg">{v.name}</span>
                      <span className="block truncate text-[12px] text-fg-subtle">{v.desc}</span>
                    </span>
                  </button>
                  <Button size="sm" variant="ghost" onClick={playHonk} aria-label={`Preview ${v.name} — honk`}>
                    honk
                  </Button>
                </div>
              );
            })}
          </div>
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
              How far the plus1 goes on its own — from quietly capturing the meeting to drafting emails
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
              <span className="text-[13px] font-medium text-fg">Honk</span>
              <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-fg-muted">
                The plus1 honks on disagreement, on a long monologue, and any time someone types
                <span className="tnum"> /honk</span> in the chat.
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
        <PanelHead title="Guardrails" />
        <div className="flex flex-col gap-0.5 p-4">
          {GUARDRAILS.map((g) => (
            <Checkbox
              key={g.id}
              on={config.guardrails[g.id]}
              label={g.label}
              onChange={(n) => set("guardrails", { ...config.guardrails, [g.id]: n })}
            />
          ))}
        </div>
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
                  <span
                    className={cx(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] border text-[13px] font-semibold transition-colors",
                      on ? "border-border-strong bg-bg text-fg" : "border-border bg-bg-subtle text-fg-subtle",
                    )}
                  >
                    {s.monogram}
                  </span>
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
                    {s.id === "email" && on && (
                      <EmailSettings
                        config={config}
                        onChange={(email) => setConfig((c) => ({ ...c, email }))}
                      />
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
