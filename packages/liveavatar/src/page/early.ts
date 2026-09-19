/**
 * The EARLY bundle: the only code that must run before Meet's JavaScript. It installs the
 * getUserMedia override (canvas camera + AudioContext mic) and nothing else. Kept tiny on
 * purpose: a large init script stalls Meet's document load (measured, 2026-09-19). The heavy
 * bridge (LiveKit etc.) is injected after the page loads and adopts the bus created here.
 */
import { DEFAULT_PAGE_MEDIA_CONFIG, type PageMediaConfig } from "../page-protocol.js";
import { installFakeMedia } from "./fake-media.js";

(() => {
  if (window.top !== window) return;
  const config: PageMediaConfig = { ...DEFAULT_PAGE_MEDIA_CONFIG, ...(window.__plus1AvatarConfig ?? {}) };
  if (config.installFakeMedia) installFakeMedia(config);
})();
