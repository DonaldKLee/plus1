import type { SVGProps } from "react";
import type { ArtifactKind } from "@/lib/types";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 18,
  height: 18,
  ...p,
});

export const Play = (p: P) => (
  <svg {...base(p)}><path d="M7 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none" /></svg>
);
export const Pause = (p: P) => (
  <svg {...base(p)}><path d="M8 5v14M16 5v14" /></svg>
);
export const Restart = (p: P) => (
  <svg {...base(p)}><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v3.5H7.5" /></svg>
);
export const Caption = (p: P) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 11.5c-1.3-1.2-3-.4-3 1 0 1.5 1.7 2.2 3 1M15 11.5c-1.3-1.2-3-.4-3 1 0 1.5 1.7 2.2 3 1" /></svg>
);
export const Chat = (p: P) => (
  <svg {...base(p)}><path d="M4 5h16v10H8l-4 4V5Z" /></svg>
);
export const Mail = (p: P) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
);
export const DocSearch = (p: P) => (
  <svg {...base(p)}><path d="M6 3h8l4 4v6M6 3v18h6" /><path d="M14 3v4h4" /><circle cx="16" cy="16.5" r="3" /><path d="m18.2 18.7 2 2" /></svg>
);
export const PageMark = (p: P) => (
  <svg {...base(p)}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>
);
export const Calendar = (p: P) => (
  <svg {...base(p)}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>
);
export const Check = (p: P) => (
  <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);
export const Alert = (p: P) => (
  <svg {...base(p)}><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4.5M12 17.6h.01" /></svg>
);
export const External = (p: P) => (
  <svg {...base(p)}><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></svg>
);
export const Console = (p: P) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></svg>
);
export const Sliders = (p: P) => (
  <svg {...base(p)}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>
);
export const Plug = (p: P) => (
  <svg {...base(p)}><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4" /></svg>
);
export const Shield = (p: P) => (
  <svg {...base(p)}><path d="M12 3 4.5 6.5v5.2c0 4.4 3.1 8.2 7.5 9.3 4.4-1.1 7.5-4.9 7.5-9.3V6.5L12 3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const Dot = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></svg>
);
export const Arrow = (p: P) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

// the plus1 mark — a "+1" cut into a signal square
export const Plus1Mark = (p: P) => (
  <svg viewBox="0 0 24 24" width={22} height={22} fill="none" {...p}>
    <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="4" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7 12h4M9 10v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14 8.4l2-1.2V16.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function ArtifactIcon({ kind, ...p }: { kind: ArtifactKind } & P) {
  switch (kind) {
    case "gmail_draft":
      return <Mail {...p} />;
    case "doc_review":
      return <DocSearch {...p} />;
    case "notion_update":
      return <PageMark {...p} />;
    case "calendar_event":
      return <Calendar {...p} />;
  }
}
