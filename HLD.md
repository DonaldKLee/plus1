# plus1 — High-Level Design

> A 3D goose in a business suit joins your meeting. It listens, answers when you talk to it, and
> does the work — drafts the email, reviews the doc you paste in the chat, books the room — while
> the meeting is still happening.

---

## 1. Purpose

Meeting assistants today are recorders. They sit outside the conversation, transcribe it, and hand
you a summary after everyone has left. By then the work they could have done is work you've already
done yourself.

plus1 is a participant instead. It joins the call with you as a visible guest, hears the
conversation in real time with speaker attribution, and acts on it while it still matters. You ask
it something the way you'd ask a coworker, out loud, and it answers out loud.

The name is the positioning: you're bringing a plus one, not sending a replacement. It's a guest
with a face and a voice, clearly artificial, doing work alongside you.

**Why a goose in a suit.** A stylized character dodges the uncanny valley entirely, a beak driven
by audio amplitude is far simpler than lipsyncing a human face, and nobody in the call is confused
about whether they're talking to a person. The absurdity is doing real design work.

---

## 2. What it does

### Core behaviors

| Behavior | Example | What happens |
|---|---|---|
| **Answers when addressed** | *"hey, what are we working on today?"* | Retrieves from the connected corpus, answers out loud in 1–2 sentences. |
| **Takes action items** | *"can you draft the sponsorship email to Bob?"* | Says "on it", creates a real Gmail draft, posts the link in the meeting chat. |
| **Reviews documents** | Paste a URL, *"review this before we send it"* | Opens it in a cloud browser, reads it, critiques it out loud, full notes in the chat. |
| **Resolves contradictions** | *"what tier did we land on with Bob?"* | Finds conflicting sources, picks one, says which and why. |
| **Stays quiet** | General conversation | Buffers context, says nothing. |
| **Honks** | Disagreement, or someone monologuing past 3 minutes | Honks. |

### What it should not do

- Speak unless addressed or the action is complete. An agent that interjects is exhausting.
- Talk over a human. Any human speech while it's speaking cancels playback immediately.
- Take irreversible actions (send, publish, delete) without an explicit spoken yes.
- Sound like a chatbot. Responses are lowercase, contracted, short, conversational.
- Claim certainty it doesn't have. Below a confidence threshold it says so and asks.

### Explicitly out of scope

Transcription-as-a-product, post-meeting summaries, impersonating a real person, and joining
meetings the user isn't in.

---

## 3. Product surface

### Setup
- Goose name, personality (deferential intern ↔ smug consultant), freeform behavior notes
- Guardrails: never commit to deadlines, never discuss comp, never send without asking
- Voice picker: a few pre-designed voices, preview button plays a honk

### Integrations
- MCP servers: Slack, Gmail, Calendar, Notion, plus "add custom MCP URL"
- Each card shows connection state and the tools that server exposes (`tools/list`)
- Per-tool policy: **Auto** (call freely) / **Ask** (announce and wait for a yes) / **Off**

### Join
- Paste a Meet link, pick **in the call** (camera + voice) or **chat only**

### Live console
Three columns:

- **Transcript** — speaker-attributed, streaming, with gate classifications highlighted
- **Mind** — what it's doing right now: `HEARD → GATED (0.94) → RETRIEVED 6 → CONFLICT → SPOKE`, each card expanding into retrieved chunks, tool call JSON, and per-hop latency
- **Artifacts** — cards appear as it creates things: the draft, the doc, the screenshot. Click to open the real thing.

The Mind column is the main debugging tool during development. Build it early.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  DASHBOARD  (Next.js → Cloudflare Pages)                 │
│  setup · integrations · live console · artifacts         │
└──────────────┬─────────────────────────┬─────────────────┘
               │ HTTPS + WS              │ WS (live events)
┌──────────────▼─────────────────────────▼─────────────────┐
│  CONTROL PLANE  (Cloudflare Workers)                     │
│    api Worker              → REST, auth, config          │
│    MeetingSession (DO)     → state machine, transcript,  │
│                              decisions, WS fan-out       │
│    D1 · R2 · Queues                                      │
└──┬──────────┬──────────┬──────────┬──────────┬───────────┘
   │ JSON-RPC │          │          │          │
┌──▼──────────┴─┐ ┌──────▼───┐ ┌────▼─────┐ ┌──▼──────────┐
│ MEETING RUNNER│ │ BACKBOARD│ │  GEMINI  │ │ MCP SERVERS │
│ Node+Playwright│ │memory/RAG│ │gate·plan·│ │slack · gmail│
│ · joins Meet   │ │ persona  │ │  review  │ │gcal · notion│
│ · fake camera  │ └──────────┘ └──────────┘ └─────────────┘
│   = 3D goose   │ ┌──────────┐ ┌──────────┐
│ · fake mic     │ │ELEVENLABS│ │BROWSERBASE│
│ · reads caps   │ │  voice   │ │doc review │
│ · reads chat   │ └──────────┘ └──────────┘
└────────────────┘
```

**The split that matters:** Workers can't run Playwright, hold WebRTC, or composite video. So the
control plane (all intelligence, all state) lives in Workers, and the data plane is one deliberately
stupid Node process that joins calls and makes zero decisions.

That boundary means the brain can be developed and tested against a recorded transcript with no
meeting running at all — which is the difference between a productive night and a miserable one.

---

## 5. The meeting runner

### 5.1 Joining

Playwright, headed Chromium, persistent user-data-dir so a burner Google account stays logged in.

```
chromium.launchPersistentContext('./profile', {
  headless: false,
  args: [
    '--use-fake-ui-for-media-stream',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
```

Navigate → set display name to `🦆 plus1 (AI)` → "Ask to join" → a human admits it. Don't automate
admission. **Burner account only, never a personal one.**

### 5.2 Fake camera and mic

Override `getUserMedia` before Meet's JS loads. The goose renders into the canvas that *is* the
camera.

```js
// addInitScript — runs before any page JS
navigator.mediaDevices.getUserMedia = async (constraints) => {
  const tracks = [];
  if (constraints.video) {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    window.__gooseCanvas = canvas;          // three.js renders here
    tracks.push(canvas.captureStream(30).getVideoTracks()[0]);
  }
  if (constraints.audio) {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    window.__audioCtx = ctx;
    window.__audioDest = dest;              // TTS plays into here
    tracks.push(dest.stream.getAudioTracks()[0]);
  }
  return new MediaStream(tracks);
};
```

**Inline the three.js bundle into the init script.** Meet's CSP blocks remote script loads, so
`import()` from a CDN fails silently. This is the single most likely thing to cost you an
unexplained hour.

**Fallback:** OBS browser source pointed at a local goose page → OBS virtual camera. Needs a real
desktop, always works.

### 5.3 Hearing the room

Turn on Meet's live captions and `MutationObserver` the caption region. Captions carry **speaker
names**, which is the most valuable signal in the system — "Kevin asked *you* to draft it" is a
different event from "someone said words."

Select on `aria-label` and `role` only. **Never hardcode Meet's class names**; they change, and you
want the selector re-derivable in five minutes.

Keep a recorded `fixtures/transcript-demo.json` so the brain can be developed offline.

### 5.4 Reading the meeting chat

Same observer pattern on the chat panel, and it's essential rather than optional:

**Spoken URLs are unusable.** "h-t-t-p-s colon slash slash docs dot google dot com slash..." will
not survive speech-to-text, ever.

The fix is also good character writing: when asked to look at something with no link in the chat,
the goose says **"drop the link in the chat and I'll take a look."** Exactly what a person says, and
it solves the problem completely.

Chat is therefore an input channel (URLs, `@plus1 do X`, `/honk`) and an output channel (artifact
links, full document reviews).

### 5.5 Speaking

Control plane sends `agent.speak` with an audio URL → runner decodes → plays into `__audioDest` →
drives the beak from the audio amplitude envelope.

**Barge-in:** human captions arriving mid-speech stop playback immediately and re-plan. Ten lines
of code, and without it the thing is unusable in a real conversation.

---

## 6. Hosting and deployment

### 6.1 Where it lives

One VPS running a long-lived supervisor process, with a Chromium instance per meeting inside it.

```
VPS (Ubuntu, 4 vCPU / 8GB)
│
├── supervisor  (Node, always running, systemd unit)
│     ├── HTTP: POST /sessions {sessionId, meetUrl}
│     ├── forks a runner child process per meeting
│     └── reaps it on leave, crash, or timeout
│
├── runner #1  → Xvfb :99  → Chromium → Meet call A   (~1.5GB)
├── runner #2  → Xvfb :100 → Chromium → Meet call B   (~1.5GB)
└── runner #3  → ...
```

The Worker doesn't orchestrate containers — it POSTs to the supervisor, which forks a process. Each
runner gets its own virtual display so Chrome instances don't share a screen, opens its own
WebSocket back to its Durable Object, and exits when the meeting ends.

Docker is optional at this size. A systemd unit plus `git pull && pm2 restart` is a perfectly good
deploy path.

### 6.2 Why a real browser on a real machine

There is no bot API. Google's Meet Media API is in developer preview behind Workspace enrollment,
so it isn't available to build against. Every meeting bot on the market — Recall, Otter, Fireflies
— is driving a real Chrome instance underneath. plus1 does the same thing.

**Headless Chrome does not work here.** It has no working audio stack and its WebRTC encoding path
behaves differently. Run headed Chrome inside `Xvfb`.

**Don't run the meeting browser on a cloud browser service.** Those are built for automation and
scraping, not for holding a WebRTC session with working media devices for 45 minutes. Browserbase
stays scoped to document review (§8.4), where ephemeral and parallel is exactly right.

### 6.3 Container / host recipe

```dockerfile
FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
      xvfb pulseaudio x11vnc fonts-liberation \
      libnss3 libatk-bridge2.0-0 libgbm1 libasound2

ENV DISPLAY=:99
CMD Xvfb :99 -screen 0 1280x720x24 & \
    pulseaudio --start --exit-idle-time=-1; \
    node dist/supervisor.js
```

A quirk worth understanding: audio the goose **sends** is generated inside the page (WebAudio →
`MediaStreamDestination`) and audio it **receives** is read as caption text from the DOM — so no
real audio ever crosses the OS audio subsystem. The dummy PulseAudio sink exists only because
Chrome can be fussy initializing `AudioContext` without one. This is a real simplification over how
most meeting bots are built.

### 6.4 Sizing

Chrome in a video call is roughly 1–1.5GB and a meaningful chunk of a core, mostly video encoding.

| VPS | Concurrent meetings |
|---|---|
| 2 vCPU / 4GB | 1–2 |
| 4 vCPU / 8GB | 3–4 |
| 8 vCPU / 16GB | 6–8 |

Scaling past one box means a second VPS with round-robin in the supervisor, or per-session Fly
machines. Don't build that before it's needed.

### 6.5 Session lifecycle

```
POST /sessions          → supervisor forks runner
runner                  → launches Chromium with persistent profile
                        → navigates to the Meet URL, sets display name, asks to join
human                   → clicks Admit
runner                  → opens WS to MeetingSession DO
                        → streams captions + chat out, receives speak/emote in
meeting ends / leave    → runner exits, supervisor reaps
```

The Durable Object is the source of truth and **outlives the container**. If a runner crashes
mid-meeting, respawn it, rejoin, and the transcript and decision history are intact. Build that
reconnect path — Chrome will die on you eventually.

### 6.6 Running it locally instead

For development, and for any meeting you're personally in, the VPS is unnecessary: run the
supervisor on your laptop, expose it with a tunnel, and point the Worker at that. Chrome opens on
your screen, you watch the goose render live, and you can intervene when Meet does something
unexpected. This is by far the fastest iteration loop — stay here for most of the build.

The VPS earns its place the moment plus1 should join a meeting when your laptop is closed. Worth
being honest that this is an ops capability rather than an intelligence one, but "joins whether or
not you're at your desk" is a genuine product difference.

### 6.7 Two things that make VPS life bearable

**Bake the Chrome profile into deployment.** The burner account's session lives in `./profile`. Log
in once locally, then rsync or bake that directory into the image. A runner that starts logged out
shows a Google sign-in wall instead of a meeting, and it is a confusing ten minutes to diagnose.

**Give yourself eyes.** Run `x11vnc` against the Xvfb display so you can VNC in and watch what
Chrome is actually doing when a join fails. Twenty minutes to set up, saves hours of blind
debugging.

---

## 7. The goose

### Model
Low-poly, stylized, in a suit. Either a CC-licensed rigged bird (attribute it in the README),
text-to-3D from Meshy or Tripo, or Blender primitives — a goose is genuinely capsules and a cone.
The suit is separate geometry and doesn't need to deform.

### Rig — four channels, that's all
| Channel | Driven by | Implementation |
|---|---|---|
| **Beak** | Audio amplitude (RMS over ~50ms) | One bone rotation or blend shape, mapped 0→1 |
| **Head look-at** | Active speaker | Rotate toward a point, change the point on speaker change. Subtle and enormously effective. |
| **Blink + idle sway** | Timer + noise | Blink every 2–6s, gentle bob. Without idle motion it reads as a frozen asset. |
| **Emotes** | `agent.emote` commands | `thinking`, `honk`, `nod`, `typing` |

### Render
Three.js into `window.__gooseCanvas` at 30fps, 720p: goose, simple backdrop, two lights, no
shadows. Keep it light enough that rendering never competes with the WebRTC encoder.

### Voice
A designed character voice — slightly-too-formal corporate middle manager who is also a goose —
with streaming TTS.

**Pre-cache filler phrases** ("on it", "one sec", "mm, let me check"). Play one the instant the gate
fires while the planner runs. Buys ~1.2s of perceived latency for free, and it's what a real person
does on a call.

### The honk
It honks when it disagrees, when someone has been talking for over three minutes, and on `/honk` in
the chat, always. Wire this early so it never gets cut.

---

## 8. The brain

### 8.1 State machine (in the `MeetingSession` Durable Object)

```
IDLE ─join─> LISTENING ─addressed──> RETRIEVING ─> DECIDING ─> SPEAKING ─> LISTENING
                 │                                                 ▲
                 ├─action_item─> ANNOUNCING ─> queue ─> EXECUTING ──┤
                 ├─review_url──> ANNOUNCING ─> BROWSERBASE ─────────┘
                 └─ignore─────> LISTENING
```

One `SPEAKING` at a time. Human speech cancels it. `EXECUTING` never blocks `LISTENING`.

### 8.2 Gate — target under 200ms

Every debounced utterance and chat message hits a fast model with a rolling 10-turn window.
Structured output only:

```json
{
  "intent": "addressed_to_me | action_item | review_url | question_about_work | small_talk | ignore",
  "confidence": 0.0,
  "requires_response": true,
  "urgency": "now | after_current_speaker | async",
  "extracted_task": "review the doc at https://...",
  "url": "https://..."
}
```

Gate cheaply, plan expensively. Most utterances die here for a fraction of a cent.

### 8.3 Planner

Input: rolling transcript (~30 turns) + persona block + retrieved evidence + available MCP tools.

```json
{
  "say": "yep, opening it now — give me twenty seconds",
  "emote": "thinking",
  "tool_calls": [{ "server": "browserbase", "tool": "review_document", "args": {"url": "..."} }],
  "chat_message": null,
  "confidence": 0.82,
  "sources": ["slack:C04.../p172...", "gmail:msg_..."]
}
```

Put ~10 few-shot examples of real conversational speech in the prompt. Response style is a feature,
not a detail — a goose that talks like a chatbot is a failed goose.

### 8.4 Document review

```
review_document(url, focus?) →
  1. Cloud browser session opens the URL
  2. Extract readable content + full-page screenshot → R2
  3. Long-context model returns a structured critique:
     { summary, strengths[], issues[{severity, location, quote, suggestion}], verdict }
  4. Two-sentence spoken version + full markdown posted to the meeting chat
  5. Artifact card with the screenshot appears in the console
```

> **Auth gotcha:** a private Google Doc won't open in a fresh cloud-browser session. Either log that
> browser context into the same burner account, or keep the document public. Test with the exact URL
> you intend to use.

### 8.5 Conflict resolution

Real corpora contradict themselves — Slack says one thing, an email supersedes it, a Notion page is
stale, and someone said "ignore what I said earlier" with no referent. Handle this as an explicit
pipeline step rather than hoping the prompt does it:

1. Retrieve top-k across sources
2. Cluster claims about the same entity
3. Detect contradictions (cheap model pass: "do these conflict?")
4. Rank: recency > externally confirmed > authored by the user > channel authority
5. Emit `{answer, confidence, winning_source, overruled_sources, reason}`
6. Below 0.6 confidence, say so out loud and ask

The spoken answer stays short; the full reasoning goes in the Mind column.

> *"seven five. slack says five but the email on the 9th supersedes it, and that's the one bob
> actually replied to. the notion doc's stale. want me to update it?"*

### 8.6 Tool policy

All tools are MCP over JSON-RPC 2.0 — one uniform client for Slack, Gmail, Calendar, Notion, and
the browser. **Auto** executes and announces after; **Ask** announces and waits for a spoken yes;
**Off** declines.

---

## 9. Data model (D1)

```sql
personas(id, user_id, goose_name, voice_id, style_prompt, guardrails_json, created_at)
integrations(id, user_id, kind, mcp_url, auth_json, tool_policy_json, status)
sessions(id, user_id, persona_id, meet_url, mode, state, started_at, ended_at)
utterances(id, session_id, ts, speaker, text, source, intent, confidence, is_agent)
                                          -- source: 'caption' | 'chat'
decisions(id, session_id, utterance_id, plan_json, sources_json,
          confidence, conflict_json, latency_ms)
actions(id, session_id, tool, args_json, status, result_json,
        artifact_url, approved_by, created_at)

-- R2: goose model + textures, TTS audio cache, screenshots
-- Backboard: persona memory + the RAG corpus
```

`decisions` powers the Mind column. Don't skip it — it's also how you debug a bad answer.

---

## 10. Runner ↔ control plane protocol

JSON-RPC 2.0 over WebSocket, same wire format as MCP, so one client covers both.

**Runner → control plane**
```json
{"jsonrpc":"2.0","method":"meeting.utterance",
 "params":{"sessionId":"s_1","speaker":"Kevin","text":"can you review this?","source":"caption","ts":1726}}
{"jsonrpc":"2.0","method":"meeting.chatMessage",
 "params":{"sessionId":"s_1","speaker":"Kevin","text":"https://docs.google.com/..."}}
{"jsonrpc":"2.0","method":"meeting.joined","params":{"participants":["Kevin","Shannon"]}}
{"jsonrpc":"2.0","method":"meeting.activeSpeaker","params":{"speaker":"Shannon"}}
{"jsonrpc":"2.0","method":"meeting.error","params":{"code":"CAPTIONS_UNAVAILABLE"}}
```

**Control plane → runner**
```json
{"jsonrpc":"2.0","id":7,"method":"agent.speak","params":{"audioUrl":"https://r2.../a7.mp3","text":"yep, on it"}}
{"jsonrpc":"2.0","id":8,"method":"agent.emote","params":{"emote":"thinking"}}
{"jsonrpc":"2.0","id":9,"method":"agent.honk","params":{}}
{"jsonrpc":"2.0","id":10,"method":"agent.lookAt","params":{"speaker":"Shannon"}}
{"jsonrpc":"2.0","id":11,"method":"agent.stopSpeaking","params":{}}
{"jsonrpc":"2.0","id":12,"method":"meeting.sendChat","params":{"text":"full review: ..."}}
{"jsonrpc":"2.0","id":13,"method":"meeting.leave","params":{}}
```

---

## 11. Repo structure

```
plus1/
├─ apps/
│  ├─ dashboard/      # Next.js — setup, integrations, live console
│  └─ runner/         # Node + Playwright — Meet, fake media, captions, chat
├─ workers/
│  ├─ api/            # Hono on Workers — REST + WS
│  ├─ session-do/     # MeetingSession Durable Object — the brain
│  └─ queue-consumer/ # async action execution
├─ packages/
│  ├─ brain/          # gate, planner, conflict resolver — pure, testable, no network
│  ├─ goose/          # three.js scene, rig, emotes, beak driver
│  ├─ mcp-client/     # JSON-RPC client, tool registry, policy enforcement
│  ├─ voice/          # TTS streaming + cached fillers
│  └─ protocol/       # shared zod schemas for §8 and §10
└─ fixtures/
   ├─ transcript-demo.json
   └─ messy-corpus/   # deliberately contradicting Slack / email / Notion data
```

---

## 12. Build order

Each step is independently testable, which is what keeps the codebase coherent as it grows.

1. **`packages/protocol`** — zod schemas for every message in §10 and every structured output in §8. Do this first; everything else references these types.
2. **`packages/brain/gate.ts`** — pure function, transcript window → intent. Test against the fixture.
3. **`workers/session-do`** — Durable Object, state machine from §8.1, WS fan-out.
4. **`apps/runner`** — Playwright join, fake media, caption + chat scraping. §5.2–5.4 are the parts most likely to be wrong when written from scratch.
5. **`packages/voice`** — streaming TTS + cached fillers.
6. **`packages/goose`** — build as a standalone HTML page first, *then* inline into the runner. Far faster iteration.
7. **`apps/dashboard`** — three-column console, fake data first, live data second.
8. **`packages/mcp-client`** — JSON-RPC client, registry, Auto/Ask/Off policy.
9. **`packages/brain/conflict.ts`** — write the test cases from the messy corpus before the code.
10. **`review_document`**, tracing, setup screens.

**Put this in `CLAUDE.md`:**

> The runner makes no decisions. All intelligence lives in `packages/brain`, which must never import
> anything network-bound. All cross-process messages use the zod schemas in `packages/protocol`.

That one constraint is what keeps things coherent through a lot of fast generation.

---

## 13. Known gotchas

| Issue | Fix |
|---|---|
| Meet's CSP blocks remote three.js | Inline the bundle into `addInitScript` |
| Meet DOM changes break captions | `aria-*` selectors only; fixture replay for offline dev |
| Google flags the account | Burner accounts only, keep a spare |
| `getUserMedia` override fails | OBS virtual camera fallback, tested in advance |
| Private doc won't open in the cloud browser | Log that context in, or use a public URL |
| Spoken URLs are garbage | Route through the meeting chat; have the goose ask for a link |
| Latency over 3s feels dead | Fast gate model, streaming TTS, pre-cached fillers |
| 3D render starves the encoder | Low-poly, 30fps, 720p, two lights, no shadows |
| Model licensing | CC-BY only, attribute with a link in the README |
| Headless Chrome has no audio stack | Run headed Chrome inside `Xvfb`, never `headless: true` |
| Runner starts logged out of Google | Bake the `./profile` directory into the deploy |
| Outbound UDP blocked on the network | Meet falls back to TCP 443 and gets laggy — test on the real network |
| Blind debugging on the VPS | `x11vnc` against the Xvfb display so you can watch Chrome |