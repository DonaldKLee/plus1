"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark, cx } from "@/components/ui";
import { Home, History, Menu, Close, Shield } from "@/components/icons";

const NAV = [
  { href: "/app", label: "Home", Icon: Home },
  { href: "/app/meetings", label: "Meetings", Icon: History },
  { href: "/app/underwrite", label: "Underwrite", Icon: Shield },
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
