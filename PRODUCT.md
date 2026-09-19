# PRODUCT.md — plus1

> Durable product truth. Not visual decisions (that's DESIGN.md), not this-session scope.

## One sentence

plus1 is a 3D plus1 in a business suit that joins your video meeting as a visible guest —
it hears the room in real time with speaker attribution, answers out loud when addressed,
and does the work (drafts the email, reviews the pasted doc, resolves contradictions across
your corpus) while the meeting is still happening.

## The mechanism nobody else has

Every other meeting assistant is a **recorder**: it sits outside the conversation, transcribes,
and hands you a summary after everyone has left. plus1 is a **participant**: it acts while it
still matters. The unique primitive is a *gate* — a sub-200ms classifier on every utterance that
decides ignore / answer / act — so it can be present without being exhausting.

## Audience & scene

The operator is a founder, PM, or ops lead running a working meeting (sponsorship call, standup,
review) on Google Meet. They are *in* the call. Alongside the meeting, on a second screen, they
watch the **console** — a live cockpit showing what plus1 heard, how it classified it, what it
retrieved, and what it did. This dashboard is that console. Its primary user is the operator
mid-meeting and the builder debugging the agent; both need to trust and audit a live autonomous
system at a glance.

## Positioning

The name is the pitch: a **plus one**, not a replacement. Clearly artificial (it's a plus1),
doing real work beside you. The absurdity of the plus1 is deliberate design — it dodges the
uncanny valley and makes the AI's presence unmistakable.

## Core behaviors (product truth the UI must reflect)

- **Answers when addressed** — retrieves from the corpus, replies out loud in 1–2 sentences.
- **Takes action items** — "on it", creates a real Gmail draft, posts the link in meeting chat.
- **Reviews documents** — opens a pasted URL in a cloud browser, critiques it out loud + in chat.
- **Resolves contradictions** — finds conflicting sources, picks one, says which and why.
- **Stays quiet** — buffers context on general conversation, says nothing.
- **Honks** — on disagreement, on a monologue past 3 minutes, and on `/honk` in chat, always.

## Non-negotiable constraints

- Never speaks unless addressed or an action just completed.
- Human speech mid-utterance cancels playback immediately (barge-in).
- Irreversible actions (send / publish / delete) require an explicit spoken **yes**.
- Below a confidence threshold it says so and asks, rather than guessing.
- Tool policy per tool: **Auto** (call + announce after) / **Ask** (announce + wait) / **Off**.

## Out of scope

Transcription-as-a-product, post-meeting summaries, impersonating a real person, joining
meetings the user isn't in.

## Platform

Web. Dashboard is Next.js → Cloudflare Pages. Console is the design-critical surface.

---

### Assumptions (inferred from the HLD brief; confirm when convenient)

- **[assumption]** The operator watches the console on a second screen during the meeting, so
  desktop-first is correct; a phone view is a monitoring convenience, not the primary scene.
- **[assumption]** The demo/showpiece is the Live Console replaying a recorded meeting fixture
  end-to-end; live meeting wiring (runner, Workers) is real engineering out of this surface's scope.
- **[assumption]** Brand commitment: mission-control / instrument-panel visual world, chosen by
  the operator. Recorded here as a standing preference.
