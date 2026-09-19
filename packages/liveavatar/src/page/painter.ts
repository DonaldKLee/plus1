/** Paints the avatar's <video> (or a placeholder) onto the camera canvas every frame. */
import type { PageMediaConfig } from "../page-protocol.js";
import { report } from "./events.js";
import { fitRect } from "./geometry.js";

const STALL_MS = 3_000;

export class Painter {
  private readonly ctx2d: CanvasRenderingContext2D;
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastVideoFrameAt = 0;
  private stallWarned = false;
  private holdLastFrame = false;
  private frames = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private config: PageMediaConfig) {
    const c = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!c) throw new Error("2d canvas context unavailable");
    this.ctx2d = c;
    this.drawPlaceholder();
    // Low-rate tick keeps the captureStream track alive while idle and detects stalls while live.
    this.tickTimer = setInterval(() => this.tick(), 200);
  }

  setConfig(config: PageMediaConfig): void { this.config = config; }

  get frameCount(): number { return this.frames; }

  /** Start drawing from a video element. */
  attach(video: HTMLVideoElement): void {
    this.detach(false);
    this.video = video;
    this.holdLastFrame = false;
    this.stallWarned = false;
    this.lastVideoFrameAt = performance.now();
    this.scheduleFrame();
  }

  /** Stop drawing video. `hold` keeps the last frame on screen (reconnects); otherwise back to the placeholder. */
  detach(hold: boolean): void {
    if (this.rafId != null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.video && "cancelVideoFrameCallback" in this.video && this.vfcId != null) {
      (this.video as any).cancelVideoFrameCallback(this.vfcId);
      this.vfcId = null;
    }
    this.video = null;
    this.holdLastFrame = hold;
    if (!hold) this.drawPlaceholder();
  }

  destroy(): void {
    this.detach(false);
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  private vfcId: number | null = null;

  private scheduleFrame(): void {
    const v = this.video;
    if (!v) return;
    if ("requestVideoFrameCallback" in v) {
      this.vfcId = (v as any).requestVideoFrameCallback(() => { this.drawVideo(); this.scheduleFrame(); });
    } else {
      this.rafId = requestAnimationFrame(() => { this.drawVideo(); this.scheduleFrame(); });
    }
  }

  private drawVideo(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    const { width, height } = this.canvas;
    const r = fitRect(v.videoWidth, v.videoHeight, width, height, this.config.fit);
    if (this.config.fit === "contain") { this.ctx2d.fillStyle = this.config.backdrop; this.ctx2d.fillRect(0, 0, width, height); }
    this.ctx2d.drawImage(v, r.x, r.y, r.w, r.h);
    this.lastVideoFrameAt = performance.now();
    this.frames++;
    if (this.stallWarned) { this.stallWarned = false; report({ kind: "log", level: "info", message: "video frames resumed" }); }
  }

  private tick(): void {
    if (this.video) {
      if (performance.now() - this.lastVideoFrameAt > STALL_MS && !this.stallWarned) {
        this.stallWarned = true;
        report({ kind: "warning", code: "VIDEO_STALLED", message: `no avatar video frames for ${STALL_MS}ms` });
      }
      return;
    }
    if (!this.holdLastFrame) this.drawPlaceholder();
  }

  /** Dark backdrop, a name badge, and a slow pulse so the frame is visibly alive, never a black square. */
  drawPlaceholder(): void {
    const c = this.ctx2d;
    const { width: w, height: h } = this.canvas;
    c.fillStyle = this.config.backdrop;
    c.fillRect(0, 0, w, h);
    const t = performance.now() / 1000;
    const pulse = 0.55 + 0.45 * Math.sin(t * 1.6);
    const cx = w / 2, cy = h / 2;
    c.beginPath(); c.arc(cx, cy - h * 0.06, h * 0.11, 0, Math.PI * 2);
    c.fillStyle = `rgba(120, 140, 160, ${0.18 + pulse * 0.12})`; c.fill();
    c.beginPath(); c.arc(cx, cy - h * 0.06, h * 0.035, 0, Math.PI * 2);
    c.fillStyle = `rgba(230, 240, 250, ${0.6 + pulse * 0.4})`; c.fill();
    c.fillStyle = "rgba(220, 228, 236, 0.9)";
    c.font = `600 ${Math.round(h * 0.06)}px system-ui, -apple-system, Segoe UI, sans-serif`;
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(this.config.label, cx, cy + h * 0.14);
  }
}
