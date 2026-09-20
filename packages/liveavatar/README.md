# @plus1/liveavatar

HeyGen **LiveAvatar** integration for plus1. The avatar *is* the plus1 on camera: LiveAvatar
renders lipsynced video from audio we push, and this package turns that stream into the
runner's fake camera and mic inside Google Meet.

```
brain (text) ─► TTS (PCM 24 kHz) ─► AvatarRig.speak ─► LiveAvatar WS ─► avatar video+audio
                                                                            │  (LiveKit room)
  Meet ◄── fake camera (canvas) + fake mic (AudioContext) ◄── in-page bridge ◄┘
```

The rig makes no decisions. It executes `speak`, `interrupt`, `honk`, `emote`. Everything that
decides *what* to say lives in `packages/brain`.

## Why LITE mode

LiveAvatar has two modes. **FULL** runs HeyGen's own STT → LLM → TTS on the mic in the room.
**LITE** ("Avatar Only") renders video from **PCM 16‑bit 24 kHz mono** audio we send over a
WebSocket, and does nothing else. plus1 uses LITE, exclusively: the brain, the gate and the
voice stay ours, and there is no second AI in the loop listening to the meeting.

Consequence: **LiveAvatar does not do TTS for us.** `packages/voice` produces PCM (ElevenLabs
`output_format=pcm_24000`, streaming) and hands it to the rig. See `packages/voice/README.md`.

## Layout

| File | Role |
|---|---|
| `src/schemas.ts` | zod schemas for LiveAvatar REST + WebSocket wire format |
| `src/client.ts` | `LiveAvatarClient`: token, start, stop, keep-alive, catalogue. Retries, timeouts, typed errors |
| `src/socket.ts` | `LiveAvatarSocket`: LITE event socket; waits for `connected`, ping/pong dead-peer detection |
| `src/speaker.ts` | `speakUtterance`: chunking (400 ms then 1 s), pacing, partial flush for streaming TTS, interrupt, completion tracking |
| `src/session.ts` | `LiveAvatarSession`: state machine `idle→starting→ready⇄speaking→stopping→stopped`, keep-alives, one utterance at a time |
| `src/rig.ts` | `AvatarRig`: Playwright-facing. Installs the page bridge, plumbs LiveKit creds, speak/interrupt/honk/emote, auto-restart |
| `src/tts.ts` | `TextToSpeech` interface for `packages/voice`, `ToneTts` stand-in, `fetchAudioAsPcm` for `agent.speak.audioUrl` |
| `src/pcm.ts` | Resample / downmix / WAV / base64 / tone synth. Pure, shared by Node and browser |
| `src/page/` | The in-page bridge (`window.__plus1Avatar`): getUserMedia override, LiveKit subscriber, canvas painter, audio mixer + honk |
| `src/page-protocol.ts` | The contract between rig and page |
| `scripts/build-page.mjs` | esbuild → one IIFE (livekit-client inlined) → `src/page-bundle.generated.ts` |
| `test/mock-liveavatar.ts` | In-process fake of the REST API and the event socket, faithful to the docs |

## Where it's wired in

`apps/backend/src/meetTranscribe.ts` owns the meeting session (join, Gemini Live
transcription, SSE to the dashboard) and hosts the rig: `rig.prepare(page)` before `goto`,
`rig.start()` on the prejoin screen, `rig.reattach()` on page reloads, `rig.interrupt()` when a
room transcription fragment arrives mid-speech. The agent exposes, per session:

```
POST /api/meet/sessions/:id/speak     {text}         text → ElevenLabs → avatar
POST /api/meet/sessions/:id/filler    {kind?}        cached "on it." / "one sec." (ack|checking|wait|unsure)
POST /api/meet/sessions/:id/interrupt                barge-in
POST /api/meet/sessions/:id/honk
POST /api/meet/sessions/:id/emote     {emote}        thinking|typing|nod|honk|idle
GET  /api/meet/sessions/:id/avatar                   {session, media, speaking}
```

and streams `avatar` events plus plus1 `line`s (with `speaker`) over the session SSE. The live
meeting page in the dashboard has the controls. Minimal standalone use:

```ts
const rig = new AvatarRig({ client: new LiveAvatarClient({ apiKey }), avatarId, tts });
await rig.prepare(page);            // BEFORE page.goto(meetUrl): tiny getUserMedia override
await page.goto(meetUrl, { waitUntil: "commit" });
await rig.start();                  // injects the bridge, starts the session, connects LiveKit
rig.speakText("yep, on it");
rig.interrupt();
```

Chromium needs `bypassCSP: true` (Meet's CSP would block the LiveKit socket) and
`--use-fake-ui-for-media-stream`. **Never** put the heavy bridge in an init script: it stalls
Meet's document load (measured). Only `EARLY_BUNDLE` (2 KiB) runs early.

### Barge-in

`rig.interrupt()` does three things at once: aborts TTS synthesis, stops the audio pump and sends
`agent.interrupt`, and **mutes the avatar's audio gain in the page immediately**. Meet goes silent
within one audio quantum, before the server has even processed the interrupt. The gain unmutes
the moment the next utterance's first chunk goes out.

Pacing makes interrupts cheap: after a 3 s lead the pump sends audio at real-time speed, so
there's never more than ~3 s buffered upstream to discard.

### Honk

LiveAvatar can't honk, so the page synthesises one (sawtooth, falling pitch, nasal bandpass,
tremolo) straight into the mic bus, ducking the avatar under it. `rig.honk()` interrupts speech
first by default; `rig.emote("honk")` doesn't.

### Emotes

LITE mode has exactly two poses. `thinking`/`typing` → listening pose, `idle` → idle pose,
`honk` → honk, `nod` → no-op.

### Session death and restart

Sessions end on the server for many reasons (`MAX_DURATION_REACHED`, idle timeout, hiccups). The
rig recreates the session with backoff, re-plumbs the new LiveKit room into the page, and holds
the last video frame during the gap so the tile doesn't flash. After `maxRestartAttempts` it emits
`dead`; the runner should report `meeting.error` and either leave or continue chat-only.

## Local development

Keys go in the repo-root `.env` (copy `.env.example`); every script loads it. From the repo root:

```bash
npm install                                        # workspaces; also builds the page bundle (prepare)
npm test        -w @plus1/liveavatar               # 50 tests against the in-process mock, ~3 s
npm run smoke   -w @plus1/liveavatar               # real API, sandbox mode (free, ~1 min, Wayne avatar)
npm run preview -w @plus1/liveavatar               # http://localhost:4173, the page bridge in a normal tab
npm run e2e:browser -w @plus1/liveavatar           # preview server + headless Chrome + real LiveKit room
npm run check:browser -w @plus1/liveavatar         # the bundle in headless Chrome, no API calls
npm run avatars -w @plus1/liveavatar               # pick an avatar_id
npm run e2e     -w @plus1/voice                    # ElevenLabs speech through the avatar, with timings
```

The preview uses ElevenLabs when `ELEVENLABS_API_KEY` is set, otherwise a tone.

Verified live on 2026-09-19 (sandbox): session ready in ~1.8 s; avatar starts speaking 230 to 470 ms
after the first PCM chunk; interrupt is immediate; the in-page bridge receives video frames and audio
(peak RMS 0.22 on the mic bus) in headless Chrome.

The preview page is HLD §12 step 6 ("build the plus1 page standalone first"): the exact bundle
that goes into the Meet tab, visible, with buttons for speak / interrupt / honk / poses and an
audio meter. Iterate there; then it just works in Meet.

Sandbox mode (`is_sandbox: true`) costs nothing, forces the Wayne avatar and ends after ~1 min.
Set `LIVEAVATAR_SANDBOX=0` and `LIVEAVATAR_AVATAR_ID` for production.

## The plus1

LiveAvatar renders human-style avatars. Custom avatars can be created from a **single image**
(no voice attached, which is fine: we bring our own). A plus1-in-a-suit image avatar is the
intended path; `avatarId` is just a config value here.

## Gotchas we already handled

- **Meet's CSP** blocks remote scripts and would block the LiveKit WebSocket from inside the tab:
  the bundle travels inside `addInitScript`, and the runner must launch with `bypassCSP: true`.
- **Remote WebRTC audio is silent to WebAudio in Chrome** unless a media element is also playing
  it. The mixer keeps a hidden `<audio>` attached (volume 0 by default), and a watchdog warns
  `AUDIO_SILENT` and kicks it if the avatar reports talking but no signal reaches the mic bus.
- **`session.state_updated: connected` must arrive before any command.** The socket enforces it.
- **Send ≤ 1 MB per packet, PCM 24 kHz mono s16le.** Chunking is 19 200 B then 48 000 B.
- **Idle timeout is 5 min.** WS keep-alive every 60 s plus REST keep-alive every 4 min.
- **The response envelope's `code`** is documented as `100` and checked as `1000` by the official
  SDK. We trust HTTP status and validate `data`, not `code`.
- **Init scripts run in every frame.** The early script only installs in the top frame.
- **A large init script stalls Meet's document load** (`readyState` stuck at `loading`). Hence the 2 KiB early bundle + late injection.
- **The room audio tap must skip the plus1's own playback.** The bridge marks its media elements `data-plus1-avatar`; the tap in `meetTranscribe.ts` skips them, otherwise the plus1 transcribes itself.
- **`getUserMedia` can be called more than once** (device switches). Each call gets fresh tracks
  from the same canvas and mixer; `enumerateDevices` advertises one camera and one mic.
- **AudioContext autoplay policy.** Chromium needs `--autoplay-policy=no-user-gesture-required`;
  the page warns `AUTOPLAY_BLOCKED` if the context stays suspended.

## Not in scope here

TTS itself (`packages/voice`), the Meet join / caption / chat scraping (`apps/runner`), and the
plus1 protocol schemas (`packages/protocol`). This package exposes a `TextToSpeech` interface and
a structural `RigPage` type so it depends on neither Playwright nor the voice provider.
