/** Pure layout math for painting the avatar frame onto the camera canvas. */
export interface Rect { x: number; y: number; w: number; h: number }

export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number, fit: "cover" | "contain"): Rect {
  if (srcW <= 0 || srcH <= 0) return { x: 0, y: 0, w: dstW, h: dstH };
  const scale = fit === "cover" ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}
