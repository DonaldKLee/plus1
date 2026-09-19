"use client";

import { useEffect, useRef, useState } from "react";
import type { GooseState } from "@/lib/types";
import { GOOSE_STATE_META } from "@/lib/maps";

/**
 * The goose, rendered as flat vector art rather than a 3D render: the console
 * needs a readable state indicator at tile size, not a portrait. The beak is
 * driven by the speech amplitude envelope, so "speaking" is legible at a glance.
 */
export function Goose({ state, amplitude }: { state: GooseState; amplitude: number }) {
  const [blink, setBlink] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const loop = () => {
      timer.current = setTimeout(
        () => {
          if (!alive) return;
          setBlink(true);
          setTimeout(() => alive && setBlink(false), 130);
          loop();
        },
        2000 + Math.random() * 4000,
      );
    };
    loop();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const color = GOOSE_STATE_META[state].color;
  const open = state === "honk" ? 20 : state === "speaking" ? 3 + amplitude * 16 : 1.5;
  const eyeH = blink ? 0.12 : 1;
  const look = state === "listening" ? 6 : state === "thinking" ? -5 : 0;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute inset-0 transition-colors duration-500"
        style={{
          background: `radial-gradient(64% 56% at 50% 36%, color-mix(in srgb, ${color} 10%, var(--bg-raise)), var(--bg-raise))`,
        }}
      />

      <svg
        viewBox="0 0 200 200"
        className={`absolute inset-0 h-full w-full ${state === "honk" ? "shake" : "sway"}`}
        role="img"
        aria-label={`plus1 is ${GOOSE_STATE_META[state].label.toLowerCase()}`}
      >
        {/* suit */}
        <path d="M40 200 L40 168 Q100 150 160 168 L160 200 Z" fill="#1b2029" />
        <path d="M74 200 L74 170 L100 182 L126 170 L126 200 Z" fill="#12161d" />
        <path d="M88 200 L88 172 L100 182 L112 172 L112 200 Z" fill="#e6eaf1" />
        <path d="M74 170 L88 172 L92 200 L78 200 Z" fill="#232935" />
        <path d="M126 170 L112 172 L108 200 L122 200 Z" fill="#232935" />
        <path d="M100 182 L96 190 L100 200 L104 190 Z" fill={color} opacity="0.94" />
        <path d="M86 176 Q100 168 114 176 L112 150 L88 150 Z" fill="#f1f4f9" />

        {/* head */}
        <g transform={`translate(${look} 0)`}>
          <ellipse cx="100" cy="86" rx="47" ry="43" fill="#f4f7fb" />
          <path d="M100 43 L143 78 L128 120 L100 130 Z" fill="#e8eef6" opacity="0.9" />
          <path d="M100 43 L57 78 L72 120 L100 130 Z" fill="#fbfdff" opacity="0.9" />
          <path d="M100 130 L128 120 L100 129 L72 120 Z" fill="#dce4ef" />
          <path
            d="M100 44 Q124 48 133 70 Q112 58 100 58 Q88 58 67 70 Q76 48 100 44Z"
            fill="#ffffff"
            opacity="0.7"
          />

          <g transform="translate(0 -2)">
            <ellipse cx="82" cy="76" rx="7.5" ry={7.5 * eyeH} fill="#11161e" />
            <ellipse cx="118" cy="76" rx="7.5" ry={7.5 * eyeH} fill="#11161e" />
            {!blink && (
              <>
                <circle cx="79.6" cy="73.4" r="2.1" fill="#fff" />
                <circle cx="115.6" cy="73.4" r="2.1" fill="#fff" />
              </>
            )}
          </g>

          {/* beak — upper and lower mandible, parted by the amplitude envelope */}
          <g>
            <path d="M100 92 L120 100 Q100 104 80 100 Z" fill="#f5972a" />
            <path
              d={`M84 100 Q100 ${104 + open} 116 100 Q108 ${108 + open} 100 ${108 + open} Q92 ${108 + open} 84 100 Z`}
              fill="#e07d16"
            />
            {open > 6 && (
              <path
                d={`M88 101 Q100 ${103 + open} 112 101 Q100 ${101 + open * 0.6} 88 101 Z`}
                fill="#5a1e12"
              />
            )}
            <circle cx="94" cy="97" r="1.5" fill="#a85e10" />
            <circle cx="106" cy="97" r="1.5" fill="#a85e10" />
          </g>
        </g>

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
