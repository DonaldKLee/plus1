"use client";

import { Console, Sliders, Plug, Shield } from "./icons";

export type View = "console" | "underwrite" | "setup" | "integrations";

const ITEMS: { id: View; label: string; Icon: typeof Console }[] = [
  { id: "console", label: "Console", Icon: Console },
  { id: "underwrite", label: "UW", Icon: Shield },
  { id: "setup", label: "Setup", Icon: Sliders },
  { id: "integrations", label: "Tools", Icon: Plug },
];

export function NavRail({
  view,
  onView,
}: {
  view: View;
  onView: (v: View) => void;
}) {
  return (
    <nav className="flex shrink-0 flex-col items-center gap-1 py-1">
      {ITEMS.map(({ id, label, Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            onClick={() => onView(id)}
            className="group relative flex h-14 w-14 flex-col items-center justify-center gap-1 rounded-[4px] border transition-all"
            style={{
              color: active ? "var(--color-act)" : "var(--color-ink-3)",
              borderColor: active ? "color-mix(in srgb, var(--color-act) 40%, transparent)" : "transparent",
              background: active ? "color-mix(in srgb, var(--color-act) 8%, transparent)" : "transparent",
            }}
          >
            {active && (
              <span
                className="absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full"
                style={{ background: "var(--color-act)" }}
              />
            )}
            <Icon width={19} height={19} />
            <span className="text-[9px] font-600 tracking-wide group-hover:text-ink-2" style={{ color: active ? "var(--color-act)" : undefined }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
