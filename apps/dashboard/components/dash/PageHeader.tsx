import type { ReactNode } from "react";
import { SendGooseButton } from "@/components/dash/SendGooseButton";

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  /** Overrides the default persistent "Send the goose" action. */
  right?: ReactNode;
}) {
  return (
    <header className="page-enter shrink-0 border-b border-border bg-bg px-5 py-6 sm:px-7 lg:px-9">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold tracking-[-0.04em] text-fg">{title}</h1>
          {description && (
            <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-fg-muted">
              {description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {right ?? <SendGooseButton />}
        </div>
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="page-enter px-5 py-7 sm:px-7 lg:px-9" style={{ animationDelay: "0.04s" }}>
      <div className="mx-auto w-full max-w-[1180px]">{children}</div>
    </div>
  );
}
