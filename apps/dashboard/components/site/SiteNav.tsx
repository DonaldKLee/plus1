"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Wordmark, cx } from "@/components/ui";
import { Menu, Close } from "@/components/icons";

export function SiteNav() {
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-40 border-b bg-bg/85 backdrop-blur-md transition-colors duration-200",
        stuck ? "border-border" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="shrink-0 rounded-[var(--r-sm)]">
          <Wordmark markSize={24} />
        </Link>

        <div className="flex items-center gap-2">
          <Link href="/app" className="hidden sm:block">
          </Link>
          <Link href="/app">
            <Button variant="primary" size="md">
              Open the console
            </Button>
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--r-sm)] text-fg-muted transition-colors hover:bg-bg-raise hover:text-fg md:hidden"
          >
            {open ? <Close width={18} height={18} /> : <Menu width={18} height={18} />}
          </button>
        </div>
      </div>

      {/* {open && (
        <div className="border-t border-border bg-bg px-5 py-3 md:hidden">
          <nav className="flex flex-col">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-border py-3 text-[14.5px] font-medium text-fg-muted transition-colors last:border-b-0 hover:text-fg"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>
      )} */}
    </header>
  );
}
