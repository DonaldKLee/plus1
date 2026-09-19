# plus1 × Intact — insurance you get by talking

A conversational way to get **car and tenant insurance** quotes: instead of a multi-page
web form, you just talk to **Bob** (our AI plus1). Bob asks only what's needed, one thing at a
time, explains any jargon, returns a transparent estimate with coverage recommendations, and —
when it gets complex or you'd rather talk to a person — offers to **hop onto a Google Meet call**
with a broker. The consumer chat funnels straight into the human channel.

## The problem

Getting insurance online is a chore: long forms, opaque pricing, and jargon most people don't
know ("deductible?", "comprehensive vs collision?"). People abandon quotes or over/under-insure
because the experience is built for the insurer, not the buyer.

## How AI is used

- **Conversational intake.** A Gemini-driven agent (`decideAction`) reads the conversation, decides
  what it still needs, and asks for it naturally — no form. It extracts structured fields
  (age, vehicle, province, contents value, …) from plain language as you chat.
- **Memory.** The agent keeps a running memory of what you've told it across turns, so it never
  re-asks and can refine a quote as new details come in.
- **Tools (the "Intact MCP").** The agent calls insurance tools the same way it calls any other:
  - `intact_quote_car` — car estimate from driver/vehicle/coverage details
  - `intact_quote_tenant` — tenant/renter estimate from location/contents/coverage
  - `intact_explain` — plain-language explainer for any coverage or term
- **Announced actions.** Every tool call is narrated first ("one sec, pricing that up…"), so it's
  never a silent black box.

The **rating engine itself is deterministic and pure** (`packages/brain/src/intact`), not the LLM —
so quotes are consistent and explainable. The AI runs the conversation; the math is auditable.

## User journey

1. Open the **Chat** tab and tell Bob what you need — e.g. *"I need renter's insurance for my
   apartment in Toronto, about $30k of stuff."*
2. Bob asks only the couple of things it still needs, and quotes early with sensible defaults
   rather than interrogating you. Missing details come back as **clearly stated assumptions**.
3. You get an **estimate** ($/month and $/year), a **coverage recommendation**, and the **main
   factors** driving the price — full transparency.
4. Tweak it out loud: *"what if I raise my deductible to $1,000?"* → instant re-quote.
5. When it's complex, or you'd rather talk to someone, Bob offers to **book a Google Meet call**
   with a broker — the same live-meeting product plus1 runs, so the handoff is seamless.

## Key features

- Car **and** tenant quoting, with bundling awareness.
- Estimate as a **range** with a monthly and annual figure (CAD).
- **Explainable pricing** — the factors that raise/lower your rate are shown every time.
- **Assumptions surfaced** — every defaulted field is stated, so the estimate stays honest.
- **Plain-language coverage explainers** on demand.
- **Escalation to a live broker call** (Google Meet) built in.
- Voice-capable (the agent can speak the quote aloud) for accessibility.

## Accessibility & UX

- Talk instead of filling forms; one question at a time; progressive disclosure.
- Jargon is explained inline, in plain words.
- Quotes are framed as ranges with the reasoning shown, not a single opaque number.
- Voice output is available for low-vision / hands-free use.

## Assumptions & limitations

- **The rating is synthetic.** Factors are realistic (age, record, province, vehicle value,
  mileage, coverage, deductible for car; location, contents, dwelling type, liability, deductible,
  claims for tenant) but the numbers are a demo model, **not** a binding Intact quote. Every quote
  says so.
- No real Intact API is wired; the engine stands in for one. Swapping in a real pricing API is a
  drop-in behind the same tools.
- Field extraction leans on the LLM; unusual phrasings may need a follow-up question.

## Future improvements

- Real Intact rating API behind the same tool interface.
- Bilingual EN/FR (Intact is Canadian — a natural accessibility + market win).
- Rich in-chat **quote cards** (breakdown, coverage toggles, what-if sliders) instead of text.
- Bundle discounts (car + tenant) and a saved-profile so returning users skip intake.
- A real "start application" step and broker calendar booking.

## Running it

The Intact tools live behind the **Intact** toggle in the dashboard's **plus1** tab. Turn it on,
open **Chat**, and talk to Bob. Backend + engine details are in the repo's `CLAUDE.md` and
`apps/backend/src/intactTools.ts`; the pure engine is `packages/brain/src/intact/quote.ts`.
