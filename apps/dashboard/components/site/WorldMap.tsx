"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A dotted globe you can spin. Land is a 5° lat/lon grid projected
 * orthographically onto a sphere; dots near the cursor swell so the surface
 * reads as touchable, and session nodes are hit-tested for hover.
 *
 * PLACEHOLDER DATA. SESSIONS is authored, not measured — swap it for the real
 * session feed and nothing else here changes.
 */

// Land coverage as inclusive column ranges per 5° grid row.
// Row r spans latitude 90−5r to 85−5r; column c spans −180+5c to −175+5c.
// prettier-ignore
const LAND: Record<number, [number, number][]> = {
  1:  [[16,24],[27,32],[54,57]],
  2:  [[12,24],[24,32],[38,42],[47,50],[56,66]],
  3:  [[4,8],[9,24],[25,32],[39,42],[43,71]],
  4:  [[3,8],[8,24],[26,32],[38,42],[42,71]],
  5:  [[3,8],[8,25],[26,28],[31,33],[37,42],[42,71]],
  6:  [[3,6],[9,25],[34,36],[37,42],[42,71]],
  7:  [[10,25],[34,42],[42,71]],
  8:  [[11,24],[35,42],[42,65]],
  9:  [[11,22],[34,45],[45,65]],
  10: [[11,21],[34,45],[45,64]],
  11: [[12,20],[34,43],[43,63]],
  12: [[13,20],[33,43],[43,47],[49,60]],
  13: [[14,18],[19,21],[32,43],[43,47],[49,60]],
  14: [[15,19],[19,24],[32,44],[44,47],[50,58]],
  15: [[17,19],[21,24],[32,45],[50,58],[60,61]],
  16: [[20,24],[33,45],[52,52],[55,58],[60,61]],
  17: [[20,26],[37,45],[55,60]],
  18: [[20,27],[38,44],[55,63]],
  19: [[20,28],[38,44],[56,64]],
  20: [[20,28],[38,44],[57,63],[61,65]],
  21: [[21,28],[38,43],[44,46],[59,65]],
  22: [[22,28],[38,43],[44,45],[58,66]],
  23: [[21,26],[39,42],[58,66]],
  24: [[21,25],[39,42],[59,66]],
  25: [[21,24],[63,66],[70,71]],
  26: [[21,23],[64,65],[70,71]],
  27: [[21,23]],
  28: [[21,22]],
  32: [[0,71]],
  33: [[0,71]],
  34: [[0,71]],
};

const DEG = Math.PI / 180;

/** Land cells as unit vectors, thinned toward the poles so spacing stays even. */
const LAND_POINTS: { x: number; y: number; z: number }[] = [];
for (const [rowKey, ranges] of Object.entries(LAND)) {
  const r = Number(rowKey);
  const lat = 87.5 - r * 5;
  const cosLat = Math.cos(lat * DEG);
  const step = Math.max(1, Math.round(1 / Math.max(cosLat, 0.08)));
  for (let c = 0; c < 72; c += step) {
    if (!ranges.some(([a, b]) => c >= a && c <= b)) continue;
    const lon = -177.5 + c * 5;
    LAND_POINTS.push({
      x: cosLat * Math.sin(lon * DEG),
      y: Math.sin(lat * DEG),
      z: cosLat * Math.cos(lon * DEG),
    });
  }
}

const SESSIONS = [
  { city: "Waterloo", lat: 43.5, lon: -80.5, note: "HTN — Sponsorship sync" },
  {
    city: "San Francisco",
    lat: 37.8,
    lon: -122.4,
    note: "Northwind — scope call",
  },
  { city: "London", lat: 51.5, lon: -0.1, note: "Ops weekly" },
  { city: "Berlin", lat: 52.5, lon: 13.4, note: "Engineering standup" },
  { city: "Bangalore", lat: 13, lon: 77.6, note: "Console design review" },
  { city: "Singapore", lat: 1.35, lon: 103.8, note: "Board prep — Q3 numbers" },
  { city: "Sydney", lat: -33.9, lon: 151.2, note: "Partner sync" },
  { city: "São Paulo", lat: -23.5, lon: -46.6, note: "Ops weekly" },
].map((s) => ({
  ...s,
  v: {
    x: Math.cos(s.lat * DEG) * Math.sin(s.lon * DEG),
    y: Math.sin(s.lat * DEG),
    z: Math.cos(s.lat * DEG) * Math.cos(s.lon * DEG),
  },
}));

const TILT = 20 * DEG;
const AUTO_SPIN = 0.0022;

function cssVar(el: HTMLElement, name: string, fallback: string) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

export function WorldMap() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [count, setCount] = useState(1284);
  const [hovered, setHovered] = useState<{
    i: number;
    x: number;
    y: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Mutable animation state — deliberately outside React so the frame loop
  // never queues a render.
  const state = useRef({
    yaw: -0.5,
    tilt: TILT,
    pointer: null as { x: number; y: number } | null,
    drag: null as { x: number; y: number } | null,
    spin: true,
  });

  useEffect(() => {
    const id = setInterval(
      () => setCount((c) => c + (Math.random() > 0.55 ? 1 : -1)),
      2600,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const host = wrap.current;
    if (!cv || !host) return;

    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    state.current.spin = !reduced;

    let size = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = host.clientWidth;
      cv.width = Math.round(size * dpr);
      cv.height = Math.round(size * dpr);
      cv.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let t = 0;

    const draw = () => {
      const s = state.current;
      if (s.spin && !s.drag) s.yaw += AUTO_SPIN;
      t += 1;

      const R = size * 0.44;
      const cx = size / 2;
      const cy = size / 2;

      const land = cssVar(cv, "--fg", "#09090b");
      const brand = cssVar(cv, "--brand", "#ffb224");

      ctx.clearRect(0, 0, size, size);

      const sinY = Math.sin(s.yaw);
      const cosY = Math.cos(s.yaw);
      const sinT = Math.sin(s.tilt);
      const cosT = Math.cos(s.tilt);

      const project = (v: { x: number; y: number; z: number }) => {
        const x1 = v.x * cosY + v.z * sinY;
        const z1 = -v.x * sinY + v.z * cosY;
        const y2 = v.y * cosT - z1 * sinT;
        const z2 = v.y * sinT + z1 * cosT;
        return { sx: cx + R * x1, sy: cy - R * y2, depth: z2 };
      };

      // land
      ctx.fillStyle = land;
      for (const p of LAND_POINTS) {
        const { sx, sy, depth } = project(p);
        if (depth <= 0.02) continue;

        let radius = 1.15 + depth * 1.05;
        let alpha = 0.12 + depth * 0.4;

        if (s.pointer) {
          const d = Math.hypot(sx - s.pointer.x, sy - s.pointer.y);
          if (d < 78) {
            const k = 1 - d / 78;
            radius += k * k * 2.1;
            alpha += k * k * 0.42;
          }
        }

        ctx.globalAlpha = Math.min(alpha, 0.92);
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // session nodes
      const hits: { i: number; sx: number; sy: number }[] = [];
      SESSIONS.forEach((sess, i) => {
        const { sx, sy, depth } = project(sess.v);
        if (depth <= 0.04) return;
        hits.push({ i, sx, sy });

        const isHot =
          s.pointer != null &&
          Math.hypot(sx - s.pointer.x, sy - s.pointer.y) < 16;

        const pulse = 0.5 + 0.5 * Math.sin(t / 26 + i * 1.7);
        ctx.globalAlpha = (0.16 + depth * 0.2) * (1 - pulse * 0.55);
        ctx.fillStyle = brand;
        ctx.beginPath();
        ctx.arc(sx, sy, 3 + pulse * 11, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = Math.min(0.45 + depth * 0.6, 1);
        ctx.beginPath();
        ctx.arc(sx, sy, isHot ? 5.4 : 3.1, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalAlpha = 1;

      // hover resolution runs on the frame so it follows the spin
      if (s.pointer && !s.drag) {
        let best: { i: number; sx: number; sy: number } | null = null;
        let bestD = 18;
        for (const h of hits) {
          const d = Math.hypot(h.sx - s.pointer.x, h.sy - s.pointer.y);
          if (d < bestD) {
            bestD = d;
            best = h;
          }
        }
        setHovered((cur) => {
          if (!best) return cur === null ? cur : null;
          if (cur && cur.i === best.i && Math.abs(cur.x - best.sx) < 1.5)
            return cur;
          return { i: best.i, x: best.sx, y: best.sy };
        });
      } else if (!s.pointer) {
        setHovered((cur) => (cur === null ? cur : null));
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const localPoint = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = e.currentTarget.getBoundingClientRect();
      state.current.drag = { x: e.clientX - r.left, y: e.clientY - r.top };
      setDragging(true);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const s = state.current;
      s.pointer = p;
      if (s.drag) {
        s.yaw += (p.x - s.drag.x) * 0.0075;
        s.tilt = Math.max(
          -1.05,
          Math.min(1.05, s.tilt + (p.y - s.drag.y) * 0.005),
        );
        s.drag = p;
      }
    },
    [],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    state.current.drag = null;
    setDragging(false);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const s = state.current;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      s.yaw -= 0.12;
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      s.yaw += 0.12;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      s.tilt = Math.min(1.05, s.tilt + 0.08);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      s.tilt = Math.max(-1.05, s.tilt - 0.08);
    }
  }, []);

  const hot = hovered ? SESSIONS[hovered.i] : null;

  return (
    <figure className="m-0">
      <div ref={wrap} className="relative mx-auto w-full max-w-[460px]">
        <canvas
          ref={canvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={(e) => {
            state.current.pointer = null;
            endDrag(e);
          }}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="img"
          aria-label="An interactive globe showing illustrative live plus1 sessions in eight cities. Drag or use the arrow keys to rotate it."
          className="w-full touch-none select-none rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
          style={{ cursor: dragging ? "grabbing" : hot ? "pointer" : "grab" }}
        />

        {hot && hovered && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] whitespace-nowrap rounded-[var(--r-sm)] border border-border bg-bg px-2.5 py-1.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]"
            style={{ left: hovered.x, top: hovered.y }}
          >
            <p className="text-[12.5px] font-medium text-fg">{hot.city}</p>
            <p className="text-[11.5px] text-fg-muted">{hot.note}</p>
          </div>
        )}
      </div>

      {/* The globe's content, for anyone who cannot see or drag it. */}
      <ul className="sr-only">
        {SESSIONS.map((s) => (
          <li key={s.city}>
            {s.city} — {s.note}
          </li>
        ))}
      </ul>

      <figcaption className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-4">
        <span className="flex items-center gap-2">
          <span
            className="dot dot-pulse"
            style={{ color: "var(--brand-text)" }}
          />
          <span className="tnum text-[13px] font-medium text-fg">
            {count.toLocaleString()}
          </span>
        </span>
        <span className="text-[13px] text-fg-muted">
          meetings a goose has sat in on
        </span>
        <span className="ml-auto text-[12px] text-fg-subtle">
          Drag to spin · illustrative data
        </span>
      </figcaption>
    </figure>
  );
}
