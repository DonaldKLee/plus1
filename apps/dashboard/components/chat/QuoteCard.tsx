"use client";

import { Chip, cx } from "@/components/ui";
import { Car, Home, Check } from "@/components/icons";
import type { QuoteResult } from "@/lib/chat";

const money = (n: number) => n.toLocaleString("en-CA");

function Factor({ label, effect }: QuoteResult["factors"][number]) {
  const color =
    effect === "raises" ? "var(--alert)" : effect === "lowers" ? "var(--live)" : "var(--fg-subtle)";
  const arrow = effect === "raises" ? "↑" : effect === "lowers" ? "↓" : "·";
  return (
    <Chip color={color}>
      <span aria-hidden>{arrow}</span>
      {label}
    </Chip>
  );
}

export function QuoteCard({ q }: { q: QuoteResult }) {
  const Icon = q.product === "car" ? Car : Home;
  const title = q.product === "car" ? "Car insurance" : "Tenant insurance";

  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-bg-subtle">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Icon width={17} height={17} className="text-fg-muted" />
          <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{title}</span>
        </div>
        <Chip color="var(--brand-text)">estimate</Chip>
      </div>

      {/* price */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-baseline gap-1.5">
          <span className="tnum text-[30px] font-semibold leading-none tracking-[-0.03em] text-fg">
            ${money(q.monthlyLow)}–{money(q.monthlyHigh)}
          </span>
          <span className="text-[13px] font-medium text-fg-muted">/mo</span>
        </div>
        <p className="tnum mt-1 text-[12.5px] text-fg-subtle">
          ${money(q.annualLow)}–{money(q.annualHigh)} / year · {q.currency}
        </p>
      </div>

      {/* recommended coverage */}
      <div className="px-4 pb-3">
        <p className="eyebrow mb-1.5">Recommended coverage</p>
        <ul className="flex flex-col gap-1">
          {q.recommended.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[13px] text-fg">
              <Check width={14} height={14} className="mt-[3px] shrink-0 text-live" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* why this price */}
      {q.factors.length > 0 && (
        <div className="px-4 pb-3">
          <p className="eyebrow mb-1.5">Why this price</p>
          <div className="flex flex-wrap gap-1.5">
            {q.factors.map((f, i) => (
              <Factor key={i} {...f} />
            ))}
          </div>
        </div>
      )}

      {/* assumptions + disclaimer */}
      <div className="border-t border-border bg-bg px-4 py-2.5">
        {q.assumptions.length > 0 && (
          <p className="text-[11.5px] leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">Assumed:</span> {q.assumptions.join(", ")}.
          </p>
        )}
        <p className={cx("text-[11px] leading-relaxed text-fg-subtle", q.assumptions.length > 0 && "mt-1")}>
          {q.disclaimer}
        </p>
      </div>
    </div>
  );
}
