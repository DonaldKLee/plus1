"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus1Mark, Dot, cx } from "@/components/ui";
import { Home, History, Menu, Close, Sliders, Chat } from "@/components/icons";
import { AGENT_URL, fetchplus1Config } from "@/lib/session";
import {
  type Config,
  enabledServers,
  loadConfig,
  normalize,
  onConfigChange,
  ToolTile,
} from "@/lib/plus1";

const NAV = [
  { href: "/app", label: "Home", Icon: Home },
  { href: "/app/chat", label: "Chat", Icon: Chat },
  { href: "/app/meetings", label: "Meetings", Icon: History },
  { href: "/app/plus1", label: "Settings", Icon: Sliders },
];

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

/** Logo tile + wordmark. Its rule is the rail's only structural divider up top. */
function Brand() {
  return (
    <Link
      href="/"
      className="flex h-[60px] shrink-0 items-center gap-2.5 px-3 transition-opacity hover:opacity-80"
    >
      <Plus1Mark size={28} />
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-fg">plus1</span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-px">
      {NAV.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cx(
              "group flex h-9 items-center gap-2.5 rounded-[var(--r-sm)] px-2.5",
              "text-[14px] tracking-[-0.01em] transition-colors duration-150",
              active
                ? "bg-bg-raise font-medium text-fg"
                : "font-normal text-fg-muted hover:bg-bg-subtle hover:text-fg",
            )}
          >
            <Icon
              width={18}
              height={18}
              className={cx(
                "shrink-0 transition-colors",
                active ? "text-fg" : "text-fg-subtle group-hover:text-fg-muted",
              )}
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The tools the plus1 currently has on, mirrored from the plus1 tab. It reads
 * this browser's cached config for an instant paint, lets MongoDB correct it,
 * and subscribes to live changes so flipping a tool on the plus1 page updates
 * the rail with no reload.
 */
function ToolsRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    setConfig(loadConfig());
    let alive = true;
    fetchplus1Config().then((stored) => {
      if (alive && stored) setConfig(normalize(stored as Partial<Config>));
    });
    const off = onConfigChange((c) => setConfig(c));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const tools = config ? enabledServers(config) : [];
  const onPlus1 = pathname.startsWith("/app/plus1");

  return (
    <div className="pb-1">
      <div className="flex items-center justify-between px-2.5 pb-1">
        <span className="text-[11.5px] font-medium tracking-[-0.01em] text-fg-subtle">Tools</span>
        <span className="tnum text-[11px] text-fg-subtle">{tools.length}</span>
      </div>
      {tools.length === 0 ? (
        <Link
          href="/app/plus1"
          onClick={onNavigate}
          className="block px-2.5 py-1.5 text-[12.5px] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          None on — turn some on
        </Link>
      ) : (
        <div className="flex flex-col gap-px">
          {tools.map((s) => (
            <Link
              key={s.id}
              href="/app/plus1"
              onClick={onNavigate}
              aria-current={onPlus1 ? "page" : undefined}
              title={s.name}
              className="group flex h-8 items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              <ToolTile tile={s.tile} size={20} />
              <span className="min-w-0 flex-1 truncate text-[13px] tracking-[-0.01em]">{s.name}</span>
              <Dot color="var(--live)" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Whether the local agent is up. The rail is the one place this belongs: it is
 * true of the whole console, not of any single page, and every feature here
 * fails the same way without it.
 */
function AgentStatus() {
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const res = await fetch(`${AGENT_URL}/health`, { cache: "no-store" });
        if (alive) setUp(res.ok);
      } catch {
        if (alive) setUp(false);
      }
    };
    ping();
    const id = setInterval(ping, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const label =
    up === null ? "Checking agent…" : up ? "Agent connected" : "Agent offline";

  return (
    <div className="flex h-9 items-center gap-2.5 px-2.5" title={AGENT_URL}>
      <span
        className={cx("dot", up === true && "dot-pulse")}
        style={{
          color:
            up === null
              ? "var(--fg-subtle)"
              : up
                ? "var(--live)"
                : "var(--alert)",
        }}
      />
      <span className="text-[12.5px] text-fg-muted">{label}</span>
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

  const rail = (
    <>
      <div className="border-b border-border">
        <Brand />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <NavList onNavigate={() => setOpen(false)} />
      </div>
      <div className="border-t border-border p-2">
        <ToolsRail onNavigate={() => setOpen(false)} />
        <div className="mt-1 border-t border-border pt-1">
          <AgentStatus />
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* mobile bar */}
      <header className="warm-rail flex h-[60px] shrink-0 items-center justify-between border-b border-border pr-3 lg:hidden">
        <Brand />
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
            className="absolute inset-0 bg-[rgba(9,9,11,0.32)] backdrop-blur-[2px]"
          />
          <div className="warm-rail rise-in absolute inset-y-0 left-0 flex w-[248px] flex-col border-r border-border">
            <div className="flex items-center justify-between border-b border-border pr-2">
              <Brand />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] text-fg-muted transition-colors hover:bg-bg-raise hover:text-fg"
              >
                <Close width={16} height={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <NavList onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-border p-2">
              <ToolsRail onNavigate={() => setOpen(false)} />
              <div className="mt-1 border-t border-border pt-1">
                <AgentStatus />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* desktop rail */}
      <aside className="warm-rail hidden w-[232px] shrink-0 flex-col border-r border-border lg:flex">
        {rail}
      </aside>
    </>
  );
}
