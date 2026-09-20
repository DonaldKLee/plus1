# plus1 × Intact: insurance you get by talking

A conversational way to get **car and tenant insurance** quotes: instead of a multi-page
web form, you just talk to **Shannon** (our AI plus1). Shannon asks only what's needed, one thing at a
time, explains any jargon, and returns a transparent estimate with coverage recommendations. When it gets complex or you'd rather talk to a person, Shannon offers to **hop onto a Google Meet call**
with a broker. The consumer chat funnels straight into the human channel.

## The problem

Getting insurance online is a chore: long forms, opaque pricing, and jargon most people don't
know ("deductible?", "comprehensive vs collision?"). People abandon quotes or over/under-insure
because the experience is built for the insurer, not the buyer.

## How AI is used

- **Conversational intake.** A Gemini-driven agent (`decideAction`) reads the conversation, decides
  what it still needs, and asks for it naturally without a form. It extracts structured fields
  (age, vehicle, province, contents value, …) from plain language as you chat.
- **Memory.** The agent keeps a running memory of what you've told it across turns, so it never
  re-asks and can refine a quote as new details come in.
- **Tools (the "Intact MCP").** The agent calls insurance tools the same way it calls any other:
  - `intact_quote_car` / `intact_quote_tenant` — estimate from what's been gathered
  - `intact_vehicle_lookup` — decode a VIN to the exact year/make/model via **real NHTSA vPIC data**
  - `intact_explain` — plain-language explainer for any coverage or term
  - `intact_email_quote` — generate a **PDF quote summary** to download (or email once Gmail's on)
  - `intact_next_step` — offer to **book a broker call** / point to belairdirect
- **Announced actions.** Every tool call is narrated first ("one sec, pricing that up…"), so it's
  never a silent black box.

The **rating engine is deterministic and pure** (`packages/brain/src/intact`), not the LLM, so
quotes are consistent and explainable. Its base rates are **calibrated to public provincial
averages** (IBC/FSRA: e.g. ON ≈ $2,068/yr, QC ≈ $1,044/yr; renters ≈ $18/mo) and adjusted by
public rate-filing factors. The AI runs the conversation; the math is auditable. Unit tests in
`quote.test.ts` assert the calibration and the accident/appetite rules.

## User journey

1. Open the **Chat** tab and tell Shannon what you need. For example, *"I need renter's insurance for my
   apartment in Toronto, about $30k of stuff."*
2. Shannon asks only the couple of things it still needs, and quotes early with sensible defaults
   rather than interrogating you. Missing details come back as **clearly stated assumptions**.
3. For a car quote it asks the right accident questions: **at-fault or not, and roughly when**,
   and never penalizes a not-at-fault claim. Give a VIN and it decodes the exact vehicle.
4. You get a **quote card**: estimate range, **pay-in-full vs monthly**, a coverage recommendation,
   and the **factors** driving the price. Full transparency.
5. Tweak it out loud: *"what if I raise my deductible to $1,000?"* → instant re-quote. Ask for it in
   writing → a **PDF summary** to download.
6. If the record is high-risk (or you'd rather talk to someone), Shannon **doesn't invent a price**, instead
   she routes you to a **broker call over Google Meet**, the same live-meeting product plus1 runs.

## Key features

- Car **and** tenant quoting, calibrated to public provincial averages, with bundling awareness.
- Rich in-chat **quote cards**, with an estimate range, monthly/annual + payment plan, coverage, and the
  factors that raise/lower the price (explainable, never a single opaque number).
- **Accident-aware:** distinguishes **at-fault vs not-at-fault** (not-at-fault never penalized),
  decays by recency, and honors **accident forgiveness**.
- **Knows when *not* to quote:** high-risk records (multiple recent at-fault, a DUI) are routed to
  a broker instead of a made-up price. This serves as an **appetite check**.
- **Real vehicle data** via VIN decode (NHTSA vPIC).
- **Payment options** shown inline: pay-in-full vs monthly instalments (with fee).
- **Emailed/downloadable PDF** quote summary.
- **Escalation to a live broker call** (Google Meet) built in.
- **Assumptions surfaced** — every defaulted field is stated, so the estimate stays honest.
- Voice-capable (the agent can speak the quote aloud) for accessibility.

## Accessibility & UX

- Talk instead of filling forms; one question at a time; progressive disclosure.
- Jargon is explained inline, in plain words.
- Quotes are framed as ranges with the reasoning shown, not a single opaque number.
- Voice output is available for low-vision / hands-free use.

## Assumptions & limitations

- **The rating is synthetic, but calibrated.** Base rates are anchored to public provincial
  averages (IBC/FSRA) and adjusted by public rate-filing factors. Although it is realistic, it is **not** a binding
  Intact quote. Every quote and PDF says so. No insurer exposes its real rating engine, so there is
  no "real Intact price" to call; our tools are structured so a real Intact/belairdirect API drops
  in behind `intact_quote_*` unchanged.
- **Driving record is self-reported.** A real insurer verifies via an Autoplus/MVR pull with
  consent; we take what you tell us (and say so).
- No policy binding, payment processing, or account access. `intact_email_quote` currently produces
  a **downloadable PDF**; wiring Gmail sends it directly (draft-only, behind the send guardrail).
- Field extraction leans on the LLM; unusual phrasings may need a follow-up question.

## Future improvements

- Real Intact rating API + Autoplus/MVR (with consent) behind the same tool interface.
- Bilingual EN/FR (Intact is Canadian, so this is a natural accessibility + market win).
- myDrive-style telematics/usage-based pricing; saved profile so returning users skip intake.
- A real "start application" step and broker calendar booking (via the Calendar action).

## Running it

The Intact tools live behind the **Intact** toggle in the dashboard's **plus1** tab. Turn it on,
open **Chat**, and talk to Shannon. Backend + engine details are in the repo's `CLAUDE.md` and
`apps/backend/src/intactTools.ts`; the pure engine is `packages/brain/src/intact/quote.ts`.
