"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark, cx } from "@/components/ui";
import { Home, History, Persona, Plug, Menu, Close } from "@/components/icons";
import { PERSONAS, DEFAULT_PERSONA_ID, ACCENT_VAR, personaById } from "@/lib/personas";
import { MEETINGS } from "@/lib/meetings";

const NAV = [
  { href: "/app", label: "Home", Icon: Home },
  { href: "/app/meetings", label: "Meetings", Icon: History },
  { href: "/app/personas", label: "Personas", Icon: Persona },
  { href: "/app/integrations", label: "Tools", Icon: Plug },
];

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cx(
              "group relative flex h-9 items-center gap-2.5 rounded-[var(--r-sm)] px-2.5",
              "text-[13.5px] font-medium tracking-[-0.01em] transition-colors duration-150",
              active
                ? "bg-bg-raise text-fg"
                : "text-fg-muted hover:bg-bg-raise/60 hover:text-fg",
            )}
          >
            {active && (
              <span
                className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full"
                style={{ background: "var(--brand)" }}
              />
            )}
            <Icon width={16} height={16} className={active ? "text-fg" : "text-fg-subtle group-hover:text-fg-muted"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function ArmedPersona() {
  const live = MEETINGS.find((m) => m.status === "live");
  const persona = personaById(live?.personaId ?? DEFAULT_PERSONA_ID);
  const accent = ACCENT_VAR[persona.accent];

  return (
    <Link
      href="/app/personas"
      className="block rounded-[var(--r)] border border-border bg-bg-subtle p-3 transition-colors duration-150 hover:border-border-strong"
    >
      <div className="flex items-center gap-1.5">
        <span className="dot dot-pulse" style={{ color: accent }} />
        <span className="eyebrow">{live ? "In this meeting" : "Armed persona"}</span>
      </div>
      <p className="mt-2 text-[13.5px] font-medium text-fg">{persona.name}</p>
      <p className="mt-0.5 text-[12.5px] leading-snug text-fg-muted">{persona.role}</p>
    </Link>
  );
}

function Account() {
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-2 pt-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
        style={{ background: "var(--bg-raise)", color: "var(--fg-muted)" }}
      >
        KV
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg">Kevin Gu</p>
        <p className="truncate text-[12px] text-fg-subtle">{PERSONAS.length} personas</p>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const panel = (
    <>
      <div className="px-2">
        <Link href="/" className="inline-flex rounded-[var(--r-sm)]">
          <Wordmark />
        </Link>
      </div>
      <div className="mt-6">
        <NavList onNavigate={() => setOpen(false)} />
      </div>
      <div className="mt-auto flex flex-col gap-3 pt-6">
        <ArmedPersona />
        <Account />
      </div>
    </>
  );

  return (
    <>
      {/* mobile bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 lg:hidden">
        <Link href="/" className="inline-flex rounded-[var(--r-sm)]">
          <Wordmark />
        </Link>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--r-sm)] text-fg-muted transition-colors hover:bg-bg-raise hover:text-fg"
        >
          <Menu width={18} height={18} />
        </button>
      </header>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <div className="rise-in absolute inset-y-0 left-0 flex w-[264px] flex-col border-r border-border bg-bg p-3">
            <div className="mb-2 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] text-fg-muted transition-colors hover:bg-bg-raise hover:text-fg"
              >
                <Close width={16} height={16} />
              </button>
            </div>
            {panel}
          </div>
        </div>
      )}

      {/* desktop rail */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-border p-3 lg:flex">
        {panel}
      </aside>
    </>
  );
}
