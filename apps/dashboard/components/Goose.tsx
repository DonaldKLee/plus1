"use client";

import { useEffect, useRef, useState } from "react";
import type { GooseState } from "@/lib/types";
import { GOOSE_STATE_META } from "@/lib/maps";

export function Goose({
  state,
  amplitude,
}: {
  state: GooseState;
  amplitude: number;
}) {
  const [blink, setBlink] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const loop = () => {
      const next = 2000 + Math.random() * 4000;
      timer.current = setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        setTimeout(() => alive && setBlink(false), 130);
        loop();
      }, next);
    };
    loop();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const color = GOOSE_STATE_META[state].color;
  // beak opening: wide on honk, amplitude-driven while speaking, tiny otherwise
  const open =
    state === "honk" ? 20 : state === "speaking" ? 3 + amplitude * 16 : 1.5;
  const eyeH = blink ? 0.12 : 1;
  const look = state === "listening" ? 6 : state === "thinking" ? -5 : 0;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* studio backdrop gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 34%, color-mix(in srgb, var(--tile-color) 16%, transparent), transparent 70%), linear-gradient(180deg,#0f1620,#0a0f16)",
          ["--tile-color" as string]: color,
        }}
      />
      {/* scanning sweep for a live-feed feel */}
      {state !== "idle" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 scan opacity-70" />
      )}

      <svg
        viewBox="0 0 200 200"
        className={`absolute inset-0 h-full w-full ${state === "honk" ? "shake" : "sway"}`}
        style={{ ["--tile-color" as string]: color }}
      >
        {/* ---- suit ---- */}
        <path d="M40 200 L40 168 Q100 150 160 168 L160 200 Z" fill="#161c26" />
        <path d="M74 200 L74 170 L100 182 L126 170 L126 200 Z" fill="#0e131b" />
        {/* shirt V */}
        <path d="M88 200 L88 172 L100 182 L112 172 L112 200 Z" fill="#dfe7f2" />
        {/* lapels */}
        <path d="M74 170 L88 172 L92 200 L78 200 Z" fill="#1d2531" />
        <path d="M126 170 L112 172 L108 200 L122 200 Z" fill="#1d2531" />
        {/* tie */}
        <path d="M100 182 L96 190 L100 200 L104 190 Z" fill={color} opacity="0.92" />
        {/* neck */}
        <path d="M86 176 Q100 168 114 176 L112 150 L88 150 Z" fill="#eef2f8" />

        {/* ---- head (low-poly white goose) ---- */}
        <g transform={`translate(${look} 0)`}>
          <ellipse cx="100" cy="86" rx="47" ry="43" fill="#f3f6fb" />
          {/* facets for dimension */}
          <path d="M100 43 L143 78 L128 120 L100 130 Z" fill="#e7edf5" opacity="0.9" />
          <path d="M100 43 L57 78 L72 120 L100 130 Z" fill="#fbfdff" opacity="0.9" />
          <path d="M100 130 L128 120 L100 129 L72 120 Z" fill="#dbe3ee" />
          {/* head-top light */}
          <path d="M100 44 Q124 48 133 70 Q112 58 100 58 Q88 58 67 70 Q76 48 100 44Z" fill="#ffffff" opacity="0.7" />

          {/* eyes */}
          <g transform={`translate(0 ${-2})`}>
            <ellipse cx="82" cy="76" rx="7.5" ry={7.5 * eyeH} fill="#10151d" />
            <ellipse cx="118" cy="76" rx="7.5" ry={7.5 * eyeH} fill="#10151d" />
            {!blink && (
              <>
                <circle cx="79.6" cy="73.4" r="2.1" fill="#fff" />
                <circle cx="115.6" cy="73.4" r="2.1" fill="#fff" />
              </>
            )}
          </g>

          {/* beak (front-on): upper + lower mandible separated by `open` */}
          <g>
            <path
              d={`M100 92 L120 100 Q100 ${104} 80 100 Z`}
              fill="#f5972a"
            />
            <path
              d={`M84 ${100} Q100 ${104 + open} 116 ${100} Q108 ${108 + open} 100 ${108 + open} Q92 ${108 + open} 84 ${100} Z`}
              fill="#e07d16"
            />
            {/* mouth cavity when open */}
            {open > 6 && (
              <path
                d={`M88 101 Q100 ${103 + open} 112 101 Q100 ${101 + open * 0.6} 88 101 Z`}
                fill="#5a1e12"
              />
            )}
            {/* nostrils */}
            <circle cx="94" cy="97" r="1.5" fill="#a85e10" />
            <circle cx="106" cy="97" r="1.5" fill="#a85e10" />
          </g>
        </g>

        {/* honk burst */}
        {state === "honk" && (
          <g stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.9">
            <path d="M150 74 l16 -8M152 90 l18 0M150 106 l16 8" />
            <path d="M50 74 l-16 -8M48 90 l-18 0M50 106 l-16 8" />
          </g>
        )}
      </svg>
    </div>
  );
}
