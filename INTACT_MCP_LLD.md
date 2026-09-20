# Intact MCP — Low-Level Design

> Build spec for the Intact insurance toolset the plus1 agent (Shannon) uses to quote car +
> tenant insurance conversationally, in chat or on a video call, and hand off to a broker.
> This is the single source of truth; hand it back to build it out fully.

---

## 0. Status (what already exists)

- `packages/brain/src/intact/quote.ts` — pure `quoteCar` / `quoteTenant` + `QuoteResult`.
- `apps/backend/src/intactTools.ts` — `runIntactTool` (car / tenant / explain), returns `{ text, quote? }`.
- `apps/backend/src/tools.ts` — routes `intact_*` through `executeTool`, gated by `ToolAccess.intact`.
- `apps/backend/src/agentBrain.ts` — tool catalog + `details` object in the response schema.
- Dashboard: `components/chat/QuoteCard.tsx` renders a `QuoteResult`; chat surface wired.

This LLD **extends** that: real calibration, at-fault vs not-at-fault, appetite→broker handoff,
vehicle lookup (real data), payment plans, and an emailed PDF quote.

---

## 1. Goal & non-goals

**Goal.** A conversational (chat + voice/video) insurance concierge that: gathers what's needed,
returns a transparent, defensible **estimate range**, explains coverages in plain language, shows
**payment options**, emails a **PDF quote summary**, and **books a broker call** when it's complex
or high-risk.

**Non-goals (state in README).** No real Intact rating API (none is public), no policy binding, no
payment processing, no account access, no MVR/Autoplus pull. Estimates are **synthetic, calibrated
to public data**, and clearly labeled. The tools are structured so a real Intact/belairdirect
rating API drops in behind `intact_quote_*` with no other change.

---

## 2. Architecture

```
Chat tab / Meet call
        │  user turns
        ▼
agentBrain.decideAction ── slot-filling MeetingState ── narrateToolResult
        │  action="tool", tool.name="intact_*", tool.details={…}
        ▼
tools.executeTool(call, access)              ← gating (access.intact)
        │
        ├─ intactTools.runIntactTool()       ← quote / explain / adjust / payment / email / next_step
        │        ├─ packages/brain/intact    ← PURE rating engine (no network)
        │        ├─ vehicleLookup()          ← REAL data: NHTSA vPIC (only external call)
        │        └─ quotePdf() + gmail        ← PDF + email artifact
        ▼
{ text, quote?, pdfUrl?, nextStep? } → chat QuoteCard / Meet chat + spoken narration
```

- **Pure** rating stays in `packages/brain/src/intact` (project rule: brain imports nothing
  network-bound).
- **All I/O** (vPIC fetch, PDF, Gmail) lives in `apps/backend/src/intactTools.ts` (+ helpers).

---

## 3. Data sources

| Need | Source | How used |
|---|---|---|
| Provincial base premium | Public averages (IBC / FSRA / rates.ca) | Baked-in constant table, the base anchor |
| Rating factor directions | Public rate-filing knowledge | Multiplier tables in the engine |
| Vehicle make/model/year/body | **NHTSA vPIC** (free, no key) | `intact_vehicle_lookup` real call |
| Renter averages | Public (~$18/mo @ $30k) | Tenant engine calibration |
| Driving/claims record | **Self-reported** (we can't pull MVR/Autoplus) | Asked in conversation; labeled unverified |

**Provincial base — annual, single adult, one vehicle, standard coverage (CAD).** Calibration
anchors from public averages; keep in one constant so it's citable:

```ts
const PROVINCE_BASE: Record<string, number> = {
  ON: 2068, QC: 1044, BC: 1800, AB: 1800, SK: 1400, MB: 1200,
  NB: 1200, NS: 1150, NL: 1250, PE: 1000, YT: 1000, NT: 1000, NU: 1000,
};
const NATIONAL_BASE = 1800; // fallback
```

**vPIC endpoint** (no auth, GET, ~1981+):
`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json`
→ `Results[0]` has `ModelYear`, `Make`, `Model`, `BodyClass`, `VehicleType`, `ErrorCode`.
Timeout 5s, cache by VIN, tolerate failure (fall back to user-stated make/model).

---

## 4. Types (contract)

Extend `packages/brain/src/intact/quote.ts`:

```ts
export type Product = "car" | "tenant";
export type Province = "ON"|"QC"|"BC"|"AB"|"SK"|"MB"|"NB"|"NS"|"NL"|"PE"|"YT"|"NT"|"NU";
export type CarCoverage = "basic" | "standard" | "full"; // liability-only / +collision / full
export type Appetite = "standard" | "high_risk" | "refer";

export interface AccidentHistory {
  atFault: number;        // count
  notAtFault: number;     // count (≈ no premium impact)
  lastAtFaultYearsAgo?: number; // recency of most recent at-fault
}

export interface CarQuoteInput {
  driverAge?: number;
  yearsLicensed?: number;
  accidents?: AccidentHistory;
  minorConvictions?: number;      // speeding etc.
  majorConvictions?: number;      // DUI / careless → high-risk
  accidentForgiveness?: boolean;  // endorsement: waives first at-fault surcharge
  province?: Province;
  city?: string;
  postal?: string;                // FSA
  vin?: string;                   // if given → vehicle lookup
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleValue?: number;          // CAD; else estimated from year/class
  annualKm?: number;
  usage?: "commute" | "pleasure" | "business";
  coverage?: CarCoverage;
  deductible?: number;            // 250 / 500 / 1000
  bundleHome?: boolean;           // home+auto discount
  winterTires?: boolean;
}

export interface TenantQuoteInput {
  province?: Province; city?: string; postal?: string;
  dwellingType?: "apartment" | "condo" | "house" | "basement";
  contentsValue?: number;         // CAD
  liabilityLimit?: number;        // 1_000_000 / 2_000_000
  deductible?: number;            // 500 / 1000
  priorClaims?: number;
  hasRoommates?: boolean;
  bundleAuto?: boolean;
}

export interface QuoteFactor { label: string; effect: "raises" | "lowers" | "neutral"; }

export interface PaymentPlan {
  annual: number;                 // pay-in-full (cheapest)
  monthly: number;                // per-instalment
  instalmentFeePct: number;       // e.g. 0.03
  methods: string[];              // ["pre-authorized debit","Visa/Mastercard","cheque"]
}

export interface QuoteResult {
  product: Product;
  currency: "CAD";
  appetite: Appetite;             // standard → quote; high_risk/refer → broker handoff
  monthlyLow: number; monthlyHigh: number;
  annualLow: number; annualHigh: number;
  payment: PaymentPlan;
  coverageTier: string;           // human label
  recommended: string[];
  factors: QuoteFactor[];
  assumptions: string[];
  handoffReason?: string;         // set when appetite != standard
  disclaimer: string;
}
```

---

## 5. Rating engine (`packages/brain/src/intact/quote.ts`)

### 5.1 Car

```
base   = PROVINCE_BASE[province] ?? NATIONAL_BASE
premium = base
  × ageFactor              // <20:1.9  20-24:1.5  25-29:1.15  30-64:1.0  65+:1.12
  × experienceFactor       // <3y:1.25  3-9y:1.05  10y+:0.95
  × recordFactor           // see 5.2
  × territoryFactor(postal)// urban FSA (M/V6/T2) 1.05–1.15; rural 0.9–1.0; default 1.0
  × vehicleFactor          // value/25000 clamped [0.7,1.4]; newer/EV slight +
  × usage                  // business 1.2  commute 1.05  pleasure 0.95
  × mileage                // >20k:1.15  <10k:0.9  else 1.0
  × coverageTier           // basic 0.6  standard 1.0  full 1.25
  × deductible             // 1000:0.9  500:1.0  250:1.1
  × discounts              // bundleHome ×0.85, winterTires ×0.97
range = [premium×0.90, premium×1.12]   // report a range, never false precision
```

`PROVINCE_BASE` is already the standard-coverage average, so `coverageTier=standard` ≈ the
published provincial average — that's the calibration check.

### 5.2 Accident / conviction handling (the important part)

```
recordFactor = 1
// at-fault: recency-decayed surcharge; forgiveness waives the first
effectiveAtFault = accidents.atFault - (accidentForgiveness ? 1 : 0)
for each of max(0, effectiveAtFault):
    w = recencyWeight(lastAtFaultYearsAgo)   // <3y:1.0  3-6y:0.5  >6y:0.15
    recordFactor *= 1 + (isFirst ? 0.25 : 0.20) * w
// NOT-at-fault: no impact (Canada standard) — surface as a neutral factor for transparency
// minor convictions: +0.08 each
recordFactor *= 1 + 0.08 * minorConvictions
```

**Appetite (when NOT to quote):**

```
appetite = "standard"
if majorConvictions > 0                          → "high_risk"
else if recentAtFault(≤3y) >= 2                  → "high_risk"
else if yearsLicensed < 1 && accidents.atFault>0 → "refer"
```

`high_risk` / `refer` → **do not return a normal price**; set `handoffReason` and return a result
whose `recommended` says a broker in the high-risk market is the right next step. The agent then
offers the **broker call** (§8). Not-at-fault accidents alone never trigger this.

Recommend `accident forgiveness` when `atFault === 0` (protect it) or `=== 1` (before the next).

### 5.3 Tenant

```
base = 120 + (contentsValue/30000)*90
  × provinceFactor  × dwellingFactor(basement 1.15, house 1.1, condo 0.95, apt 1.0)
  × (liability 2M ? 1.1 : 1.0) × (deductible 1000 ? 0.9 : 1.0)
  × (1 + 0.2*priorClaims) × (hasRoommates ? 1.08 : 1.0) × (bundleAuto ? 0.90 : 1.0)
range = [×0.9, ×1.12]   // ~$18/mo @ $30k apt = calibration check
```

### 5.4 Payment plan

```
annual   = round(mid, 10)
monthly  = round(annual × (1 + instalmentFeePct) / 12)   // instalmentFeePct = 0.03
methods  = ["pre-authorized debit", "Visa / Mastercard", "cheque"]
```
Copy: "annual is cheapest; monthly adds a small instalment fee."

---

## 6. Coverage vocabulary (use Intact's real names)

- **Mandatory:** Third-Party Liability (property damage + injury to others), Accident Benefits.
- **Standard/Optional:** Collision, Comprehensive (theft/fire/hail/vandalism), Roadside (add-on),
  myDrive (telematics discount), Bundle (home+auto).
- Tenant: Contents (replacement cost), Personal Liability, Additional Living Expenses,
  Water/Sewer backup (add-on).

`intact_explain` returns one plain sentence per term (map already started in `intactTools.ts`).

---

## 7. Tools (final set)

All gated by `access.intact`. Routed in `tools.ts` via `name.startsWith("intact_")` →
`runIntactTool(name, { query, details })`. Each returns `ToolResult { text, quote?, pdfUrl?, nextStep? }`.

| Tool | details / args | Returns | Notes |
|---|---|---|---|
| `intact_quote_car` | `CarQuoteInput` | `text` + `quote` | quote early w/ defaults; assumptions surfaced |
| `intact_quote_tenant` | `TenantQuoteInput` | `text` + `quote` | |
| `intact_vehicle_lookup` | `{ vin }` | `text` (decoded car) + merges into state | **real vPIC call**; 5s timeout, cache |
| `intact_explain` | `{ query }` | `text` | plain-language coverage explainer |
| `intact_payment_plan` | `{ annual }` or reuse last quote | `text` (annual vs monthly) | usually embedded in `quote.payment` |
| `intact_email_quote` | `{ email }` (+ last quote from state) | `text` + `pdfUrl` | PDF + Gmail draft (§9) |
| `intact_next_step` | `{ intent }` | `text` + `nextStep` | broker call (Meet) / find-a-broker (§8) |

**Adjust / what-if** is not a separate tool: the agent re-calls `intact_quote_*` with the merged
`details` from slot-filling state ("raise deductible to $1000" → re-quote). Document this in the
tool docs so the model does it.

Add `details.vin`, `details.accidents{atFault,notAtFault,lastAtFaultYearsAgo}`,
`details.bundleHome`, etc. to the response schema in `agentBrain.ts buildResponseSchema`.

### Schema additions (agentBrain.ts, only when an intact tool is present)
Extend the `details` object properties with: `vin`, `atFaultAccidents`, `notAtFaultAccidents`,
`lastAtFaultYearsAgo`, `minorConvictions`, `majorConvictions`, `bundleHome`, `winterTires`,
`bundleAuto`, `email`. (Numbers/strings/bools mirroring the input types.)

---

## 8. Broker-call escalation (`intact_next_step`)

Reuses the existing Meet handoff.
- `standard` appetite + user wants to proceed → offer to **book a broker call** (create a Google
  Meet event via the Calendar action once wired; until then, return a "find a broker" message +
  the chat "Start a meeting" button already in the UI).
- `high_risk` / `refer` appetite → **lead** with the broker call; do not quote a number.
- Returns `nextStep: { kind: "broker_call" | "find_broker", meetUrl?, brokerLine: "1-866-464-2424" }`.

Prompt behavior: Shannon says e.g. *"with two at-fault claims in the last three years this needs a
broker who works the high-risk market — want me to set up a quick call?"*

---

## 9. Emailed PDF quote (`intact_email_quote`)

- **PDF generator:** add `pdf-lib` (pure, no native deps) in the backend; `quotePdf(quote, applicant)`
  → `Uint8Array`. Save to a served path or attach to the email.
- **Email:** Gmail action (draft-only for safety, behind the `sendApproval` guardrail). Until Gmail
  OAuth is wired, fall back to returning a **downloadable PDF artifact** in chat (render a card with
  a download link) so the demo still shows the artifact.
- **PDF contents:** quote ref # · date · province · applicant summary · coverage breakdown
  (Third-Party Liability, Accident Benefits, Collision/Comprehensive + deductibles) · premium
  (**annual and monthly** w/ instalment note) · assumptions · next step (book broker / belairdirect) ·
  "estimate, not binding" disclaimer · plus1/Intact branding.

---

## 10. Conversational behavior (prompt / slot-filling)

Add to the intact tool docs + a short intact behavior note (only when `access.intact`):

- Quote **early** with sensible defaults; surface every default as a stated assumption; don't
  interrogate with a long form.
- Ask accident history as **at-fault vs not-at-fault + when** — never penalize not-at-fault.
- For a VIN, call `intact_vehicle_lookup` first, then quote.
- If `appetite != standard`, **do not invent a price** — explain why and offer the broker call.
- After a quote: offer to **adjust** (deductible/coverage/bundle), show **payment options**, and
  offer to **email the PDF** and/or **book a broker call**.
- Slot-filling `MeetingState.collected` holds applicant facts across turns (already in place).

---

## 11. Dashboard rendering

- `QuoteCard.tsx` (exists): add **appetite badge** (standard/high-risk), **payment row** (annual vs
  monthly), and a **bundle hint** when `bundleHome/bundleAuto` would save.
- New `QuotePdfCard` (or reuse the tool card): download link when `pdfUrl` present.
- High-risk quote → card shows the handoff reason + a "Book a broker call" button (→ Meet).

---

## 12. File plan

Create:
- `packages/brain/src/intact/quote.ts` — extend engine (§4, §5) + `PROVINCE_BASE`, appetite, payment.
- `apps/backend/src/intactVehicle.ts` — `vehicleLookup(vin)` (vPIC, cached, timeout).
- `apps/backend/src/intactPdf.ts` — `quotePdf(quote, applicant)` via `pdf-lib`.

Modify:
- `apps/backend/src/intactTools.ts` — add `intact_vehicle_lookup`, `intact_email_quote`,
  `intact_next_step`; thread `pdfUrl` / `nextStep` through `IntactToolResult`.
- `apps/backend/src/tools.ts` — `ToolResult` gains `pdfUrl?`, `nextStep?`.
- `apps/backend/src/agentBrain.ts` — tool catalog entries + `details` schema fields + intact note.
- `apps/dashboard/lib/chat.ts` — `QuoteResult` gains `appetite`, `payment`, `handoffReason`;
  `ChatMessage` gains `pdfUrl?`.
- `apps/dashboard/components/chat/QuoteCard.tsx` — appetite badge, payment row, bundle hint,
  handoff button.
- `INTACT.md` — README updates (§14).

Deps: `pdf-lib` (backend). vPIC + Gmail need no new deps (fetch / existing Google action).

---

## 13. Testing

- **Engine unit tests** (`quote.test.ts`): province calibration (ON standard ≈ 2068 ±10%),
  at-fault raises / not-at-fault neutral, forgiveness waives first, recency decay, appetite
  thresholds (2 recent at-fault → high_risk; major conviction → high_risk), tenant ≈ $18/mo @ $30k,
  payment monthly > annual/12.
- **vehicleLookup**: a known VIN decodes to make/model/year; bad VIN → graceful fallback.
- **End-to-end (chat)**: "renter, Toronto, $30k" → card; "car, 27, one at-fault last year" → higher
  + forgiveness rec; "two at-faults in 2 years" → high-risk + broker offer; "email it to x@y.com" →
  PDF + confirmation.

---

## 14. README / judging (criterion #4)

Extend `INTACT.md`: problem (form→portal→phone is clunky); AI (conversational intake, slot-filling,
tool-calling, voice); journey (chat/call → transparent quote → adjust → payment → PDF → broker
call); features; **assumptions/limitations** (synthetic pricing calibrated to public averages;
self-reported record; no binding/payment; real API swaps in behind the tools); future (real Intact
rating API, EN/FR, telematics/myDrive, real Autoplus/MVR with consent).

---

## 15. Build order

1. Engine: `PROVINCE_BASE` calibration + at-fault/not-at-fault + appetite + payment (§5). Unit tests.
2. `intact_vehicle_lookup` (vPIC) — the real data call.
3. Schema + tool-doc + prompt updates (§7, §10); QuoteCard appetite/payment (§11).
4. `intact_email_quote` → PDF (pdf-lib) + download-card fallback; Gmail when the Google action lands.
5. `intact_next_step` broker-call handoff (Meet).
6. README (§14).
