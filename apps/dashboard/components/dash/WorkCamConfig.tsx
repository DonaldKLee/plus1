"use client";

import { useEffect, useState } from "react";
import { Panel, PanelHead, Button, Chip, Dot, cx } from "@/components/ui";

const AGENT =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  process.env.NEXT_PUBLIC_FEDERATO_AGENT_URL ??
  "http://localhost:8787";

const STORAGE_KEY = "plus1.workcam.mode";

export type WorkCamMode = "local" | "cloud";

const MODES: {
  id: WorkCamMode;
  title: string;
  summary: string;
}[] = [
  {
    id: "local",
    title: "Local + Present",
    summary:
      "Meet joins in headed Chrome with Google's screenshare flags (Entire screen auto-select). Keep the plus1-work tab visible on that display.",
  },
  {
    id: "cloud",
    title: "Cloud + camera",
    summary:
      "Meet joins on Browserbase (signed-in Context). Work streams onto the camera tile — Present is unavailable in cloud Chrome.",
  },
];

async function fetchMode(): Promise<WorkCamMode> {
  try {
    const res = await fetch(`${AGENT}/api/work-cam/config`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { mode?: string };
      if (json.mode === "local" || json.mode === "cloud") return json.mode;
    }
  } catch {
    /* fall through */
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "local" || raw === "cloud") return raw;
  } catch {
    /* ignore */
  }
  return "local";
}

async function saveMode(mode: WorkCamMode): Promise<boolean> {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(`${AGENT}/api/work-cam/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function WorkCamConfig() {
  const [mode, setMode] = useState<WorkCamMode>("local");
  const [ready, setReady] = useState(false);
  const [remote, setRemote] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const m = await fetchMode();
      if (alive) {
        setMode(m);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pick = (next: WorkCamMode) => {
    setMode(next);
    void saveMode(next).then((ok) => {
      setRemote(ok);
      setFlash(true);
      setTimeout(() => setFlash(false), 1200);
    });
  };

  if (!ready) return null;

  return (
    <Panel>
      <PanelHead
        title="Work browser in Meet"
        right={
          flash ? (
            <Chip color="var(--live)">
              <Dot color="var(--live)" pulse />
              Saved
            </Chip>
          ) : null
        }
      />
      <div className="flex flex-col gap-4 px-5 py-5">
        <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-fg-muted">
          How Browserbase work shows up in Google Meet. Local uses Present (screenshare);
          cloud puts the stream on the camera tile.
          {remote ? " Saved on the backend." : null}
        </p>
        <div className="flex flex-col gap-2">
          {MODES.map((m) => {
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => pick(m.id)}
                className={cx(
                  "flex w-full items-start gap-3 rounded-[var(--r)] border px-4 py-3 text-left transition-colors",
                  on
                    ? "border-border bg-bg-raise"
                    : "border-transparent bg-bg hover:border-border",
                )}
              >
                <span
                  className={cx(
                    "mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2",
                    on ? "border-[var(--live)] bg-[var(--live)]" : "border-border bg-transparent",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-fg">{m.title}</span>
                    {on && (
                      <Chip color="var(--live)">
                        <Dot color="var(--live)" />
                        Active
                      </Chip>
                    )}
                  </div>
                  <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-fg-muted">
                    {m.summary}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[12px] text-fg-subtle">
          Cloud mode needs{" "}
          <code className="tnum rounded bg-bg-raise px-1.5 py-0.5">npm run backend:workcam-login</code>
          once. Local mode uses the screenshare Chrome profile (
          <code className="tnum rounded bg-bg-raise px-1.5 py-0.5">npm run backend:google-login</code>
          ).
        </p>
      </div>
    </Panel>
  );
}

/** Compact mode chip for the Underwrite controls row. */
export function WorkCamModeToggle({
  mode,
  onChange,
}: {
  mode: WorkCamMode;
  onChange: (m: WorkCamMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-[var(--r)] border border-border bg-bg p-0.5">
      {(["local", "cloud"] as const).map((id) => (
        <Button
          key={id}
          size="sm"
          variant={mode === id ? "primary" : "ghost"}
          className="h-7 px-2.5 text-[12px]"
          onClick={() => onChange(id)}
        >
          {id === "local" ? "Local Present" : "Cloud cam"}
        </Button>
      ))}
    </div>
  );
}

export { fetchMode as fetchWorkCamMode, saveMode as saveWorkCamMode };
