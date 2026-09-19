import raw from "@/data/transcript-demo.json";
import type { Fixture } from "./types";

// Canonical source lives at /fixtures/transcript-demo.json (shared with the
// runner + brain). This copy is what the dashboard replays.
export const fixture = raw as unknown as Fixture;
