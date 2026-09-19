import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SVGProps } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ---------------------------------------------------------------- brand ---- */

/**
 * The plus1 mark: a Canada goose head in profile, beak in brand amber, with a
 * suit collar at the neck. Two-tone so it survives on either theme.
 */
export function GooseMark({
  size = 24,
  eye = "var(--bg)",
  ...p
}: SVGProps<SVGSVGElement> & {
  size?: number;
  /** The punched-out eye. Override when the mark sits on an inverted tile. */
  eye?: string;
}) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden {...p}>
      {/* neck, sweeping down and left out of the head */}
      <path
        d="M12.8 19.5C11.4 23.5 10.8 27.4 10.6 31.2h7.8c.2-4 1-7.8 2.2-11.2Z"
        fill="currentColor"
      />
      <ellipse cx="17" cy="13" rx="9" ry="8.4" fill="currentColor" />
      <path d="M25.4 10.2 31.6 13.4 25.4 16.6Z" fill="var(--brand)" />
      <circle cx="20.2" cy="11.2" r="1.5" fill={eye} />
    </svg>
  );
}

export function Wordmark({ className, markSize = 22 }: { className?: string; markSize?: number }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <GooseMark size={markSize} className="text-fg" />
      <span className="text-[16px] font-semibold tracking-[-0.03em] text-fg">plus1</span>
    </span>
  );
}

/* --------------------------------------------------------------- button ---- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "brand";
  size?: "sm" | "md" | "lg";
};

const BTN_VARIANT: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-inverse-bg text-inverse-fg shadow-[var(--shadow-sm)] hover:bg-[var(--inverse-bg-hover)] disabled:opacity-40 disabled:hover:bg-inverse-bg",
  secondary:
    "bg-bg border border-border text-fg shadow-[var(--shadow-sm)] hover:bg-bg-subtle hover:border-border-strong disabled:opacity-40",
  ghost: "text-fg-muted hover:text-fg hover:bg-bg-raise disabled:opacity-40",
  brand:
    "bg-brand text-[var(--brand-ink)] hover:brightness-95 disabled:opacity-40",
};

const BTN_SIZE: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[var(--r-sm)]",
  md: "h-9 px-3.5 text-[13.5px] gap-2 rounded-[var(--r-sm)]",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-[var(--r)]",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...p
}: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium tracking-[-0.01em] whitespace-nowrap",
        "transition-[opacity,background-color,border-color,filter] duration-150",
        "disabled:cursor-not-allowed",
        BTN_SIZE[size],
        BTN_VARIANT[variant],
        className,
      )}
      {...p}
    />
  );
}

/* ---------------------------------------------------------------- input ---- */

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-10 w-full rounded-[var(--r-sm)] border border-border bg-bg px-3 text-[14px] text-fg",
        "transition-colors duration-150 hover:border-border-strong",
        "focus:border-border-strong focus:outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--ring)]",
        className,
      )}
      {...p}
    />
  );
}

/* ----------------------------------------------------------------- card ---- */

export function Panel({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <As
      className={cx(
        "rounded-[var(--r)] border border-border bg-bg shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      {children}
    </As>
  );
}

/** Panel header: title on the left, controls on the right, one hairline below. */
export function PanelHead({
  title,
  right,
  className,
}: {
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4",
        className,
      )}
    >
      <span className="text-[13px] font-medium tracking-[-0.01em] text-fg">{title}</span>
      {right}
    </div>
  );
}

/* ----------------------------------------------------------------- chip ---- */

export function Chip({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span className={cx("chip", className)} style={color ? { color } : undefined}>
      {children}
    </span>
  );
}

export function Dot({ color, pulse }: { color?: string; pulse?: boolean }) {
  return (
    <span
      className={cx("dot", pulse && "dot-pulse")}
      style={color ? { color } : undefined}
    />
  );
}

/** A named measurement: label above, tabular value below. */
export function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <span className="tnum text-[15px] font-medium text-fg" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- empty ---- */

export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-[14px] font-medium text-fg">{title}</p>
      <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-fg-muted">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
