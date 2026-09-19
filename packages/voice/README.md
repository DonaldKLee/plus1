# @plus1/voice

plus1's voice. ElevenLabs streaming TTS as **PCM 16-bit 24 kHz mono**, the format
`@plus1/liveavatar` feeds the avatar, plus pre-cached filler phrases.

```ts
import { voiceFromEnv, FillerCache } from "@plus1/voice";
import { AvatarRig } from "@plus1/liveavatar";

const tts = voiceFromEnv();                       // ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL
const fillers = new FillerCache({ tts, voiceKey: `${tts.voiceId}:${tts.model}` });
await fillers.warm();                             // 11 phrases; from disk after the first run

const rig = new AvatarRig({ client, avatarId, tts });
// gate fired → say something instantly while the planner runs
rig.speakPcm(fillers.pick("ack")!.pcm);
// planner done → stream the real answer; avatar starts moving ~300 ms after the first chunk
rig.speakText(plan.say);
```

## Facts that shape this package

- `ElevenLabsTts.synthesize()` streams `POST /v1/text-to-speech/{voice}/stream?output_format=pcm_24000`
  with `eleven_flash_v2_5`. Measured ~450 ms to first byte. Chunks are re-aligned to whole 16-bit
  samples across network boundaries.
- The `AbortSignal` cancels the HTTP body mid-stream. Barge-in aborts synthesis, not just playback.
- Errors are typed: `AUTH` (401/403), `QUOTA` (402/429), `TIMEOUT` (no first byte), `API_ERROR`.
  On `QUOTA` the runner should fall back to fillers rather than retry.
- The current key is on the **free tier: 10 000 characters/month**. `npm run voices` prints usage.
  Fillers cost ~200 chars once per voice; the e2e run costs ~460.
- Text is normalised before synthesis: markdown stripped, URLs become "the link" (spoken URLs are
  useless anyway, see HLD §5.4).
- Default voice: Daniel (`onwK4e9ZLuTAKqWW03F9`), a steady British broadcaster. Settings in
  `GOOSE_VOICE_SETTINGS`. Swap via `ELEVENLABS_VOICE_ID`.

## Scripts

```bash
npm run voices  -w @plus1/voice            # list voices + quota
npm run say     -w @plus1/voice -- "on it" out.wav
npm run fillers -w @plus1/voice            # warm the cache for the configured voice
npm run e2e     -w @plus1/voice            # ElevenLabs → LiveAvatar sandbox, with timings
npm test        -w @plus1/voice            # against an in-process mock, no characters spent
```

Keys live in the repo-root `.env` (see `.env.example`); scripts load it automatically.
