/**
 * Cloud Meet fake-camera: Browserbase CDP screencast → canvas → getUserMedia.
 * Local Present uses a separate visible preview tab + native Chrome tab capture
 * (Meet rejects canvas getDisplayMedia even locally).
 */
export const WORK_CAM_W = 1280;
export const WORK_CAM_H = 720;
export const WORK_CAM_FPS = 24;

/** Visible fullscreen canvas page — Chrome Present captures this tab natively. */
export const WORK_PREVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>plus1-work</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #0b0f14; overflow: hidden; }
    canvas { display: block; width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <canvas id="c" width="${WORK_CAM_W}" height="${WORK_CAM_H}"></canvas>
  <script>
(() => {
  const W = ${WORK_CAM_W}, H = ${WORK_CAM_H};
  const canvas = document.getElementById("c");
  const g = canvas.getContext("2d", { alpha: false, desynchronized: true });
  window.__plus1WorkCanvas = canvas;
  const api = (window.__plus1WorkCam = { gumCalls: 0, gdmCalls: 0, _pending: null, _drawing: false });

  const drawFill = (img) => {
    if (!g) return;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, W, H);
  };

  const pump = () => {
    if (api._drawing) return;
    const b64 = api._pending;
    if (!b64) return;
    api._pending = null;
    api._drawing = true;
    const img = new Image();
    img.onload = () => {
      try { drawFill(img); } finally {
        api._drawing = false;
        if (api._pending) pump();
      }
    };
    img.onerror = () => { api._drawing = false; if (api._pending) pump(); };
    img.src = "data:image/jpeg;base64," + b64;
  };

  api.drawJpeg = (b64) => { api._pending = b64; pump(); };
  api.setLabel = (text) => {
    if (!g) return;
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#8b9bb4";
    g.font = "28px system-ui,sans-serif";
    g.fillText(String(text || "").slice(0, 80), 48, H / 2);
  };
  api.setLabel("plus1 work — waiting for Browserbase…");
})();
  </script>
</body>
</html>`;

/**
 * Re-installable hooks for cloud camera mode only.
 * Safe to call after Meet mutates mediaDevices.
 */
export const WORK_CAM_REHOOK_SCRIPT = `(() => {
  const W = ${WORK_CAM_W}, H = ${WORK_CAM_H}, FPS = ${WORK_CAM_FPS};
  let canvas = window.__plus1WorkCanvas;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    window.__plus1WorkCanvas = canvas;
    try { document.documentElement.appendChild(canvas); } catch (_) {}
  } else {
    canvas.width = W;
    canvas.height = H;
  }
  const g = canvas.getContext("2d", { alpha: false, desynchronized: true });

  if (!window.__plus1WorkCam) {
    window.__plus1WorkCam = { gumCalls: 0, gdmCalls: 0, _pending: null, _drawing: false };
  }
  const api = window.__plus1WorkCam;

  // Stretch to fill canvas — Meet camera tiles crop with cover anyway;
  // letterbox just wastes the tile as big black bars.
  const drawFill = (img) => {
    if (!g) return;
    const sw = img.naturalWidth || img.width || W;
    const sh = img.naturalHeight || img.height || H;
    if (!sw || !sh) return;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, W, H);
  };

  const pump = () => {
    if (api._drawing) return;
    const b64 = api._pending;
    if (!b64) return;
    api._pending = null;
    api._drawing = true;
    const img = new Image();
    img.onload = () => {
      try { drawFill(img); } finally {
        api._drawing = false;
        if (api._pending) pump();
      }
    };
    img.onerror = () => {
      api._drawing = false;
      if (api._pending) pump();
    };
    img.src = "data:image/jpeg;base64," + b64;
  };

  api.drawJpeg = (b64) => {
    // Coalesce: only keep the latest frame (drops backlog → less lag)
    api._pending = b64;
    pump();
  };
  api.setLabel = (text) => {
    if (!g) return;
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#8b9bb4";
    g.font = "28px system-ui,sans-serif";
    g.fillText(String(text || "").slice(0, 80), 48, H / 2);
  };

  const videoTrack = () => {
    const t = canvas.captureStream(FPS).getVideoTracks()[0];
    try {
      if (t) {
        t.contentHint = "detail";
        t.applyConstraints?.({
          width: { ideal: W },
          height: { ideal: H },
          frameRate: { ideal: FPS },
        });
      }
    } catch (_) {}
    return t;
  };

  const md = navigator.mediaDevices;
  if (!md) return { ok: false, reason: "no mediaDevices" };

  md.getUserMedia = async (constraints) => {
    api.gumCalls++;
    const tracks = [];
    if (!constraints || constraints.video !== false) {
      if (!constraints || constraints.video) {
        const t = videoTrack();
        if (t) tracks.push(t);
      }
    }
    if (constraints && constraints.audio) {
      try {
        const ctx = window.__plus1WorkAudioCtx || new AudioContext({ sampleRate: 48000 });
        window.__plus1WorkAudioCtx = ctx;
        const dest = window.__plus1WorkAudioDest || ctx.createMediaStreamDestination();
        window.__plus1WorkAudioDest = dest;
        const t = dest.stream.getAudioTracks()[0];
        if (t) tracks.push(t.clone());
      } catch (_) {}
    }
    return new MediaStream(tracks);
  };

  // Stub only — Meet rejects canvas DisplayMedia; cloud Present still fails.
  // Camera path uses getUserMedia above.
  md.getDisplayMedia = async () => {
    api.gdmCalls++;
    throw new DOMException("plus1: use camera path on cloud; Present needs local tab capture", "NotAllowedError");
  };

  md.enumerateDevices = async () => {
    const mk = (kind, deviceId, label) =>
      ({ kind, deviceId, groupId: "plus1-work", label, toJSON() { return { kind, deviceId, groupId: "plus1-work", label }; } });
    return [
      mk("videoinput", "plus1-work-cam", "plus1 work camera"),
      mk("audioinput", "plus1-work-mic", "plus1 work mic"),
      mk("audiooutput", "default", "Default"),
    ];
  };

  window.__plus1WorkCamInstalled = true;
  return { ok: true, w: W, h: H };
})()`;

export const WORK_CAM_EARLY_SCRIPT = `(() => {
  if (window.top !== window) return;
  ${WORK_CAM_REHOOK_SCRIPT}
  try {
    window.__plus1WorkCam?.setLabel("plus1 work cam — waiting…");
  } catch (_) {}
})();`;
