import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-border px-5 py-6 sm:px-7 lg:px-9">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[21px] font-semibold tracking-[-0.03em] text-fg">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-[68ch] text-[13.5px] leading-relaxed text-fg-muted">
              {description}
            </p>
          )}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-7 sm:px-7 lg:px-9">
      <div className="mx-auto w-full max-w-[1180px]">{children}</div>
    </div>
  );
}
