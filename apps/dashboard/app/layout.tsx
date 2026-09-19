import type { Metadata, Viewport } from "next";
import { Archivo, Saira, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
  display: "swap",
});
const saira = Saira({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-saira",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "plus1 — console",
  description:
    "The operator's cockpit for plus1: a 3D goose that joins your meeting, hears the room, and does the work while it's still happening.",
};

export const viewport: Viewport = {
  themeColor: "#090d13",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${saira.variable} ${mono.variable}`}>
      <body>
        {/* ────────────────────────────────────────────────────────────────
            DIRECTION CONTRACT · seed: pinned-by-operator (no concept roll)
            THESIS: The operator's live cockpit for an autonomous agent inside a
              meeting. It refuses the SaaS-dashboard card grid; it is an
              instrument panel you'd trust to run live — every reading is a
              measurement, every colour names a state.
            OWN-WORLD: Darkened mission-control room. Cool blue-graphite ground,
              hairline-ruled panels with corner reticles, Archivo Expanded
              signage + JetBrains Mono data. Signal palette encodes meaning:
              green=heard, amber=gating, cyan=the goose acting, coral=conflict/honk.
            STORY: The operator, mid-meeting on a second screen, sees what plus1
              heard, how it classified it, what it retrieved, and what it did —
              and trusts it, or overrides it, at a glance.
            FIRST VIEWPORT: Mission clock + goose camera-tile up top; three live
              columns below — TRANSCRIPT (gated), MIND (the signal pipeline
              lighting hop by hop), ARTIFACTS (work appearing as it's made).
            FORM: Instrument panel / glass-cockpit console. Direction pinned by
              the operator; no roll. FINISH: unreviewed and undocumented is
              unfinished; this build ends with the finish review, the verdict,
              DESIGN.md, and every shipping raster carrying its provenance.
        ──────────────────────────────────────────────────────────────── */}
        {children}
      </body>
    </html>
  );
}
