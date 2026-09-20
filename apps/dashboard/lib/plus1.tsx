"use client";

/**
 * The plus1's configuration — shared by the plus1 tab (which edits it) and the
 * rail (which shows the enabled tools). The tab is the source of truth: it
 * writes localStorage and MongoDB and broadcasts a `plus1:config` event so any
 * mounted surface (the rail) reflects a toggle the instant it flips.
 */

import type { ReactElement, SVGProps } from "react";
import { cx } from "@/components/ui";
import { HardDrive, Mail, PageMark, Send, Target, Coins, CalendarLock } from "@/components/icons";

export type ServerId = "federato" | "intact" | "local" | "docs" | "email";
export type AccessLevel = "read" | "write";

export type GuardrailId = "sendApproval" | "groundClaims" | "noComp" | "noDeadlines";

export interface Config {
  name: string;
  persona: string;
  autonomy: number;
  confidence: number;
  honk: boolean;
  monologueMin: number;
  guardrails: Record<GuardrailId, boolean>;
  servers: Record<ServerId, boolean>;
  localAccess: AccessLevel;
}

export const DEFAULT_CONFIG: Config = {
  name: "Shannon",
  persona:
    "You're a warm, sharp insurance teammate. Keep it plain-spoken and friendly, explain jargon without being asked, and never oversell — recommend only what someone actually needs.",
  autonomy: 45,
  confidence: 68,
  honk: true,
  monologueMin: 3,
  // sendApproval + groundClaims are the safety floor (defaults on). The house
  // rules (comp, deadlines) are opt-in — now that they actually reach the model.
  guardrails: { sendApproval: true, groundClaims: true, noComp: false, noDeadlines: false },
  servers: { federato: true, intact: true, local: false, docs: false, email: true },
  localAccess: "read",
};

export const STORAGE_KEY = "plus1.plus1.config";

/** Fill in anything a stored config is missing, whatever its source. */
export function normalize(p: Partial<Config>): Config {
  return {
    ...DEFAULT_CONFIG,
    ...p,
    guardrails: { ...DEFAULT_CONFIG.guardrails, ...(p.guardrails ?? {}) },
    servers: { ...DEFAULT_CONFIG.servers, ...(p.servers ?? {}) },
    localAccess: p.localAccess === "write" ? "write" : "read",
  };
}

/** This browser's cached copy — the instant paint, before MongoDB answers. */
export function loadConfig(): Config {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return normalize(JSON.parse(raw) as Partial<Config>);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/* ------------------------------------------------------------- tools ---- */

type IconCmp = (p: SVGProps<SVGSVGElement>) => ReactElement;

/** How a tool's 36px tile is drawn: a real brand logo, or an authored glyph. */
export type Tile =
  | { kind: "brand"; src: string; fit: "cover" | "contain"; bg: string }
  | { kind: "icon"; Icon: IconCmp };

export interface ServerMeta {
  id: ServerId;
  name: string;
  summary: string;
  tile: Tile;
}

export const SERVERS: ServerMeta[] = [
  {
    id: "federato",
    name: "Federato",
    summary:
      "Underwriting appetite and submissions — schema discovery, query planning, per-policy scoring.",
    tile: { kind: "brand", src: "/brands/federato.png", fit: "cover", bg: "#2a201c" },
  },
  {
    id: "intact",
    name: "Intact",
    summary:
      "Conversational car + tenant insurance quoting — Bob gathers what's needed and returns an estimate with coverage recommendations.",
    tile: { kind: "brand", src: "/brands/intact.png", fit: "contain", bg: "#ffffff" },
  },
  {
    id: "local",
    name: "Local access",
    summary: "Read and write files on this machine, scoped to the working directory.",
    tile: { kind: "icon", Icon: HardDrive },
  },
  {
    id: "docs",
    name: "Documents",
    summary:
      "Generic notes PDFs (off by default). Quote / indication PDFs come from Federato or Intact so the masthead matches.",
    tile: { kind: "icon", Icon: PageMark },
  },
  {
    id: "intact",
    name: "Intact",
    summary:
      "Personal car and tenant quotes. Quote PDFs from this path say Intact, never Federato.",
    tile: { kind: "brand", src: "/brands/intact.png", fit: "contain", bg: "#ffffff" },
  },
  {
    id: "email",
    name: "Email",
    summary:
      "Send email over SMTP, with a generated PDF attached. Needs GMAIL_USER + GMAIL_APP_PASSWORD (or the SMTP_* vars) in .env — without them the plus1 drafts but nothing goes out.",
    tile: { kind: "icon", Icon: Mail },
  },
];

/** The enabled tools, in panel order — what the rail lists. */
export function enabledServers(config: Config): ServerMeta[] {
  return SERVERS.filter((s) => config.servers[s.id]);
}

/**
 * A tool's mark at any size: a real brand logo for Federato/Intact, an authored
 * SVG glyph for the utility tools. `on={false}` dims it to read as disabled.
 */
export function ToolTile({
  tile,
  size = 36,
  on = true,
  className,
}: {
  tile: Tile;
  size?: number;
  on?: boolean;
  className?: string;
}) {
  const radius = size >= 28 ? "rounded-[var(--r-sm)]" : "rounded-[6px]";
  if (tile.kind === "brand") {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, background: on ? tile.bg : undefined }}
        className={cx(
          "relative flex shrink-0 items-center justify-center overflow-hidden border border-border",
          radius,
          !on && "bg-bg-subtle opacity-60 grayscale",
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={tile.src}
          alt=""
          className={cx("h-full w-full", tile.fit === "cover" ? "object-cover" : "object-contain p-[3px]")}
        />
      </span>
    );
  }
  const { Icon } = tile;
  const glyph = Math.round(size * 0.52);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cx(
        "flex shrink-0 items-center justify-center border transition-colors",
        radius,
        on ? "border-border-strong bg-bg text-fg" : "border-border bg-bg-subtle text-fg-subtle",
        className,
      )}
    >
      <Icon width={glyph} height={glyph} />
    </span>
  );
}

/* -------------------------------------------------------- guardrails ---- */

export interface GuardrailMeta {
  id: GuardrailId;
  label: string;
  hint: string;
  Icon: IconCmp;
}

/**
 * These map 1:1 to `GUARDRAIL_CLAUSES` in the backend (agentBrain.ts): each one
 * is injected into the system prompt as a hard rule, so a toggle here actually
 * changes what the plus1 will and won't do.
 */
export const GUARDRAILS: GuardrailMeta[] = [
  {
    id: "sendApproval",
    label: "Get a yes before it sends, publishes, or deletes",
    hint: "Any irreversible action pauses and waits for an explicit spoken confirmation.",
    Icon: Send,
  },
  {
    id: "groundClaims",
    label: "Never state a number it can't back with a tool",
    hint: "No guessed prices, rates, or decisions — it pulls the data or says it doesn't have it.",
    Icon: Target,
  },
  {
    id: "noComp",
    label: "Don't discuss compensation or headcount",
    hint: "Salary, comp, and staffing questions get declined and steered back to the task.",
    Icon: Coins,
  },
  {
    id: "noDeadlines",
    label: "Don't commit to dates on your behalf",
    hint: "It offers to note a deadline and leaves the commitment to a human.",
    Icon: CalendarLock,
  },
];

/* ----------------------------------------------------- live broadcast ---- */

export const CONFIG_EVENT = "plus1:config";

/** Tell any mounted surface (the rail) that the config just changed. */
export function broadcastConfig(config: Config): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent<Config>(CONFIG_EVENT, { detail: config }));
  } catch {
    /* CustomEvent unavailable — the rail falls back to its polled copy */
  }
}

/** Subscribe to config changes: same-tab broadcasts and cross-tab storage. */
export function onConfigChange(cb: (config: Config) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onBroadcast = (e: Event) => {
    const detail = (e as CustomEvent<Config>).detail;
    if (detail) cb(normalize(detail));
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb(loadConfig());
  };
  window.addEventListener(CONFIG_EVENT, onBroadcast);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CONFIG_EVENT, onBroadcast);
    window.removeEventListener("storage", onStorage);
  };
}
