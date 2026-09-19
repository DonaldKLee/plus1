"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { Chevron, Check } from "@/components/icons";
import { ACCENT_VAR, PERSONAS, personaById } from "@/lib/personas";

export function PersonaSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const selected = personaById(value);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, PERSONAS.findIndex((p) => p.id === value)));
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, value]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % PERSONAS.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + PERSONAS.length) % PERSONAS.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onChange(PERSONAS[active].id);
      setOpen(false);
    }
  };

  return (
    <div ref={root} className={cx("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className={cx(
          "flex h-10 w-full items-center gap-2.5 rounded-[var(--r-sm)] border bg-bg px-3 text-left",
          "transition-colors duration-150",
          open ? "border-border-strong" : "border-border hover:border-border-strong",
        )}
      >
        <span className="dot" style={{ color: ACCENT_VAR[selected.accent] }} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg">
          {selected.name}
          <span className="ml-1.5 font-normal text-fg-subtle">{selected.role}</span>
        </span>
        <Chevron
          width={15}
          height={15}
          className={cx("shrink-0 text-fg-subtle transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Persona"
          className="rise-in absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-[var(--r)] border border-border-strong bg-bg p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.6)]"
        >
          {PERSONAS.map((p, i) => {
            const isSel = p.id === value;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-start gap-2.5 rounded-[var(--r-sm)] px-2.5 py-2 text-left transition-colors duration-100",
                    i === active ? "bg-bg-raise" : "bg-transparent",
                  )}
                >
                  <span className="dot mt-[7px]" style={{ color: ACCENT_VAR[p.accent] }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-medium text-fg">{p.name}</span>
                      <span className="text-[12.5px] text-fg-subtle">{p.role}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">
                      {p.purpose}
                    </span>
                  </span>
                  {isSel && <Check width={14} height={14} className="mt-[3px] shrink-0 text-fg-muted" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
