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

export const Home = (p: P) => (
  <svg {...base(p)}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8.5Z" /></svg>
);
export const History = (p: P) => (
  <svg {...base(p)}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V9H8" /><path d="M12 7.5V12l3 1.8" /></svg>
);
export const Persona = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
);
export const Search = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
);
export const Chevron = (p: P) => (
  <svg {...base(p)}><path d="m6 9.5 6 6 6-6" /></svg>
);
export const Plus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const Link = (p: P) => (
  <svg {...base(p)}><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.6 1.6" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.6-1.6" /></svg>
);
export const Clock = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.2V12l3.2 1.9" /></svg>
);
export const Menu = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const Close = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const Mic = (p: P) => (
  <svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" /></svg>
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
