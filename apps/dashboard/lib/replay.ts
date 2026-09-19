"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Fixture, GooseState, MeetingEvent } from "./types";

const SPEAK_TAIL = 2100; // ms the goose keeps "speaking" after a SPOKE/ANNOUNCED hop
const TOOL_TAIL = 900;
const HONK_WINDOW = 1400;

export interface DecisionView {
  event: MeetingEvent;
  litHops: number; // how many hops are lit at the current clock
  firingIndex: number; // hop that just fired (for pop animation), or -1
  active: boolean;
  done: boolean;
}

function lastHopMs(e: MeetingEvent): number {
  const d = e.decision;
  if (!d || d.hops.length === 0) return 0;
  return d.hops[d.hops.length - 1].ms;
}

function decisionEnd(e: MeetingEvent): number {
  return e.t + lastHopMs(e) + SPEAK_TAIL;
}

export function useMeetingReplay(fixture: Fixture) {
  const events = fixture.events;
  const endT = useMemo(
    () => Math.max(...events.map((e) => decisionEnd(e))) + 1600,
    [events],
  );

  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);

  // optional deep-link into the replay: ?t=<ms> jumps there and holds (paused).
  // Applied on mount (client only) to avoid a hydration mismatch.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t == null) return;
    const n = Number(t);
    if (Number.isFinite(n)) {
      setClock(Math.max(0, n));
      setPlaying(false);
    }
  }, []);

  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    if (!playing) {
      lastRef.current = null;
      return;
    }
    const step = (ts: number) => {
      if (lastRef.current == null) lastRef.current = ts;
      const dt = ts - lastRef.current;
      lastRef.current = ts;
      setClock((c) => {
        const next = c + dt * speedRef.current;
        if (next >= endT) {
          setPlaying(false);
          return endT;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, endT]);

  const restart = useCallback(() => {
    setClock(0);
    lastRef.current = null;
    setPlaying(true);
  }, []);
  const toggle = useCallback(() => {
    setClock((c) => (c >= endT ? 0 : c));
    setPlaying((p) => !p);
  }, [endT]);
  const seek = useCallback(
    (t: number) => {
      setClock(Math.max(0, Math.min(endT, t)));
      lastRef.current = null;
    },
    [endT],
  );

  // ---- derivations from the clock (declarative; pause/seek are free) ----

  const transcript = useMemo(
    () => events.filter((e) => e.kind === "utterance" && e.t <= clock),
    [events, clock],
  );

  const decisions = useMemo<DecisionView[]>(() => {
    return events
      .filter((e) => e.decision && e.t <= clock)
      .map((e) => {
        const d = e.decision!;
        let lit = 0;
        let firing = -1;
        d.hops.forEach((h, i) => {
          const at = e.t + h.ms;
          if (at <= clock) {
            lit = i + 1;
            if (clock - at < 260 * speedRef.current) firing = i;
          }
        });
        const done = clock >= decisionEnd(e);
        return { event: e, litHops: lit, firingIndex: firing, active: !done && lit > 0, done };
      })
      .reverse(); // newest first
  }, [events, clock]);

  const artifacts = useMemo(
    () =>
      events
        .filter((e) => e.artifact && clock >= e.t + lastHopMs(e))
        .map((e) => ({ artifact: e.artifact!, id: e.id }))
        .reverse(),
    [events, clock],
  );

  const activeDecision = decisions.find((d) => d.active);

  const honk = useMemo(() => {
    const h = events.find(
      (e) => e.kind === "honk" && clock >= e.t && clock < e.t + HONK_WINDOW,
    );
    return h ?? null;
  }, [events, clock]);

  const gooseState: GooseState = useMemo(() => {
    if (honk) return "honk";
    if (activeDecision) {
      const d = activeDecision.event.decision!;
      const stage = d.hops[activeDecision.litHops - 1]?.stage ?? "HEARD";
      const clockRel = clock - activeDecision.event.t;
      // barge-in cancels playback → drop to listening
      if (d.bargedInAtMs && clockRel >= d.bargedInAtMs) return "listening";
      switch (stage) {
        case "SPOKE":
        case "ANNOUNCED":
          return "speaking";
        case "TOOL":
          return "typing";
        case "HEARD":
          return "listening";
        default:
          return "thinking";
      }
    }
    // recent human utterance → listening
    const lastUtt = [...events].reverse().find((e) => e.kind === "utterance" && e.t <= clock);
    if (lastUtt && clock - lastUtt.t < 2600) return "listening";
    if (clock >= endT) return "idle";
    return "idle";
  }, [honk, activeDecision, clock, events, endT]);

  const activeSpeaker = useMemo(() => {
    if (gooseState === "speaking" || gooseState === "typing") return fixture.meta.gooseName;
    const lastUtt = [...events].reverse().find((e) => e.kind === "utterance" && e.t <= clock);
    return lastUtt?.speaker ?? null;
  }, [gooseState, events, clock, fixture.meta.gooseName]);

  // synthetic amplitude envelope for the beak while speaking
  const amplitude = useMemo(() => {
    if (gooseState !== "speaking" && gooseState !== "honk") return 0;
    if (gooseState === "honk") return 1;
    const s = clock / 90;
    const v =
      0.5 +
      0.32 * Math.sin(s) +
      0.18 * Math.sin(s * 2.7 + 1) +
      0.12 * Math.sin(s * 5.3 + 2);
    return Math.max(0.06, Math.min(1, v));
  }, [gooseState, clock]);

  const started = clock > 0 || playing;
  const ended = clock >= endT;

  return {
    clock,
    endT,
    playing,
    speed,
    setSpeed,
    started,
    ended,
    transcript,
    decisions,
    activeDecision,
    artifacts,
    honk,
    gooseState,
    activeSpeaker,
    amplitude,
    restart,
    toggle,
    seek,
  };
}
