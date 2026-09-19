/**
 * Entry point of the in-page bundle. Installs `window.__plus1Avatar`.
 * Runs at document start via Playwright addInitScript, so it must be cheap and
 * must not touch the DOM until it exists (we defer canvas/audio creation until
 * first use, except the getUserMedia override which must be immediate).
 */
import { DEFAULT_PAGE_MEDIA_CONFIG, PAGE_GLOBAL, type PageBridgeApi, type PageConnectParams, type PageMediaConfig } from "../page-protocol.js";
import { base64ToBytes } from "../pcm.js";
import { AvatarMedia } from "./avatar-media.js";
import { report } from "./events.js";
import { fakeMediaInstalled, getBus, installFakeMedia } from "./fake-media.js";
import { Mixer } from "./mixer.js";
import { Painter } from "./painter.js";

const VERSION = "0.1.0";

declare global {
  interface Window { [PAGE_GLOBAL]?: PageBridgeApi }
}

(function main() {
  if (window[PAGE_GLOBAL]) return; // already installed (init scripts can run more than once)
  let config: PageMediaConfig = { ...DEFAULT_PAGE_MEDIA_CONFIG, ...(window.__plus1AvatarConfig ?? {}) };

  let painter: Painter | null = null;
  let mixer: Mixer | null = null;
  let media: AvatarMedia | null = null;
  let avatarTalking = false;

  const ensure = () => {
    const bus = getBus(config);
    painter ??= new Painter(bus.canvas, config);
    mixer ??= new Mixer(bus, config.monitorVolume);
    media ??= new AvatarMedia(painter, mixer);
    return { bus, painter, mixer, media };
  };

  // The override has to exist before Meet asks for a camera, i.e. now.
  if (config.installFakeMedia) {
    const r = installFakeMedia(config);
    if (!r.installed) report({ kind: "warning", code: "GUM_NOT_INTERCEPTED", message: r.reason ?? "unknown" });
  }
  // Silence watchdog: only meaningful while the avatar should be talking.
  setInterval(() => mixer?.checkSilence(avatarTalking), 500);

  const api: PageBridgeApi = {
    version: VERSION,
    configure(partial) {
      config = { ...config, ...partial };
      painter?.setConfig(config);
      mixer?.setMonitorVolume(config.monitorVolume);
    },
    installFakeMedia() { return installFakeMedia(config); },
    async connect(params: PageConnectParams) {
      const { media } = ensure();
      return media.connect(params);
    },
    async disconnect() {
      await media?.disconnect(false);
      avatarTalking = false;
    },
    setAvatarMuted(muted) {
      ensure().mixer.setMuted(muted);
      avatarTalking = !muted;
    },
    honk(opts) { return ensure().mixer.honk(opts); },
    playPcm(b64, opts) { return ensure().mixer.playPcm(base64ToBytes(b64), opts); },
    getState() {
      return {
        state: media?.state ?? "idle",
        video: media?.hasVideo ?? false,
        audio: media?.hasAudio ?? false,
        muted: mixer?.isMuted ?? false,
        fakeMediaInstalled: fakeMediaInstalled(),
      };
    },
    snapshot() { return ensure().bus.canvas.toDataURL("image/png"); },
  };

  Object.defineProperty(window, PAGE_GLOBAL, { value: api, writable: false, configurable: false });
  // Make sure the placeholder is painting as soon as there's a document to paint into.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => ensure(), { once: true });
  else ensure();
})();
