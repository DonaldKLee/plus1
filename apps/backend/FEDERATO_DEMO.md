# Federato challenge — how the goose uses the tools, and the demo script

The agent ("Bob") sits in the meeting (or the chat tab) and treats Federato as its lane: when
the room talks about a submission, an account, a broker, a state, a hazard or appetite, it pulls
the data with a tool, then answers like an underwriter — **decision → the factor that drives it →
recommendation → next step**. Nothing about a specific submission is hard-coded: the schema is
read at runtime, queries are planned per question, and every attempt is traced.

## The pipeline, in the challenge's own words: ingest → enrich → classify

`federato_submissions` runs the open submission queue (received / cleared / quoted) through three
labelled stages, and every result carries the stage trace:

1. **INGEST** — the submissions with insured and broker, joined to every policy already on file for
   that insured: locations, buildings, five-year same-line loss history. New vs renewal is derived
   from whether the insured already has a policy in that line.
2. **ENRICH** — six free, keyless real-world sources for the primary location, cached per location:
   FEMA National Risk Index (composite + per-peril county ratings), OpenFEMA disaster declarations
   since 2015, OpenFEMA NFIP flood claims in the zip, USGS M4.5+ earthquakes within 150 km since
   2000, Open-Meteo five-year weather extremes (gust, rain, heat), and OpenStreetMap reverse
   geocoding to check the coordinates against the county on the broker's file.
3. **CLASSIFY** — the 2025 appetite table plus the enrichment factors → quote / refer / investigate /
   decline, the rule behind every factor, and the exact list of what to request from the broker
   (premium indication, statement of values, loss runs, construction detail…).

## The tools it has

| Tool | Answers | Rubric line |
|---|---|---|
| `federato_submissions(filter?)` | the OPEN queue after ingest → enrich → classify, with broker request lists | **ingest submissions**, enrichment, explanations |
| `federato_queue(filter?)` | the bound property book ranked, counts, top five and why | score + rank, explanations |
| `federato_account(name\|id)` | one file: decision, every factor + rule, contradictions, broker, what to request next | explanations, contradictions |
| `federato_query(question)` | anything in the data: counts, lists, group-bys | **agentic reasoning**: plan → validate → run → adapt |
| `federato_portfolio(dimension)` | existing exposure by state / hazard / construction / broker / decision | portfolio context |
| `federato_enrich(name)` | FEMA declarations, NFIP flood claims, weather extremes for the primary location, and how they move the score | **enrichment that changes the decision** |
| `federato_guidelines(topic?)` | the 2025 appetite table or a glossary term | domain grounding |
| `federato_draft(request)` | for an **open submission**: the draft contract package (ingest → enrich → classify → draft, every field tagged with its source, terms seeded from the expiring policy, open items listed); for a bound account: quote letter, declarations page, decline letter, memo — all marked draft for review | actionable output |

The brain may **chain**: a tool result can ask for one follow-up (queue → account → enrich),
capped at three, and each interim line is spoken so the room never waits in silence.

## Demo script (say these in the meeting, or type them in the Chat tab)

0. **"Bob, what came in on the property side, and what do we still need from the brokers?"**
   → `federato_submissions("property")` → the six open property submissions, each with where its
   exposure came from ("2 locations from 3 prior policies; 2 claims in the last 5 years on 1
   property policy"), the classification, and *"need from broker: premium indication"*. The trace
   shows INGEST / ENRICH / CLASSIFY with timings and the sources that answered.

1. **"Bob, what's in the property queue today?"**
   → `federato_queue` → *"twenty-seven in the queue, two refers and twenty-five declines. top is
   cedar valley health, a refer: premium and TIV are in target, but it's a renewal and renewals are
   out under the 2025 guidelines. want the file?"*
2. **"Yeah, pull up Harbor Point."**
   → `federato_account("harbor point")` → decision DECLINE, score −12/24, the five hard fails read
   as rules ("premium six-twenty is over the one-seventy-five cap; majority frame construction;
   losses one point six million…"), the broker (Cardinal & Vale), and the contradiction: FL is a
   target state but the file fails everywhere else.
3. **"Is flood actually a problem at that address?"**
   → `federato_enrich("harbor point")` → *"hillsborough county has twenty-one FEMA declarations
   since 2015, mostly hurricane, and one-twenty-seven NFIP flood claims in that zip. that's a hard
   fail on the FEMA factor on its own — the call stays decline, score drops from minus ten to
   minus twelve."* (**enrichment visibly influencing the score**)
4. **"How exposed are we already to flood across the book?"**
   → `federato_portfolio("hazard")` → *"twenty-one of twenty-seven policies touch a flood-tagged
   location, about eighty-three percent of TIV."* (**portfolio context**)
5. **"Which brokers send us the most declined submissions?"**
   → `federato_query(...)` → the planner writes `Submission where status=declined, expand broker,
   over broker.name, count, sort desc`; the console shows the query and *"pacific coast, three;
   highland and meridian, two each"*. (**dynamic query construction, traceable**)
6. **"How many active property policies do we have in California, and what's the premium?"**
   → `federato_query` → `$elemMatch` through exposure_units → *"eight, two point three million in
   premium."*
7. **"Remind me — what's the premium rule?"**
   → `federato_guidelines("premium")` → *"fifty to one-seventy-five is acceptable, seventy-five to
   a hundred is target, outside that is out."*
7b. **"Prep the contract for Willowbrook."** → `federato_draft` on open submission SUB-2025-00134 →
   an 11-section draft contract package: parties, submission, schedule of locations (from the
   insured's policies on file), five-year loss history, external risk data table (six sources),
   appetite assessment, proposed terms (limit from the submission, deductible/commission/coverages
   from the expiring property policy, premium as `[[ TO BE PROVIDED ]]`), forms, conditions and
   subjectivities, authority and sign-off. Every field has a **Source** column. Merrin Hale (new
   business, no expiring policy) shows the same template with placeholders instead of seeded terms.
   Files: `output/drafts/contract-SUB-….md` and `.json`; `GET /api/federato/contract/SUB-2025-00134?format=md`.
8. **"Draft the decline letter for Harbor Point."** → `federato_draft` → a broker-facing letter
   citing each failed 2025 rule verbatim, the supporting external data, and "what would change the
   outcome"; saved under `output/drafts/` and readable at `/api/federato/draft/1001?kind=decline`.
   Also: "quote letter for cedar valley" (terms, coverage schedule, locations, forms, subjectivities,
   authority check against the assigned underwriter's limit) and "dec page for 1001".
9. **"What would it take to quote Cross Continental?"** (no tool needed after step 1's data; if the
   brain lacks it, it pulls the account) → names the missing data / the factors that would have to
   change, and offers to draft the broker note.

Each step shows up in the dashboard's **Goose decisions** panel with the reasoning, and the
session notes carry `why:` lines: the exact query payload, validation feedback, how many rows,
whether groups were collapsed, and which external sources answered.

## Try it without a meeting

```bash
# any tool, directly
curl -s localhost:8787/api/federato/tool -H 'content-type: application/json' \
  -d '{"name":"federato_account","query":"harbor point"}' | jq -r .text

# the open queue after ingest → enrich → classify
curl -s 'localhost:8787/api/federato/submissions' | jq '.hops, .ranked[0]'

# the contract package from a submission (markdown or the structured JSON with sources)
curl -s 'localhost:8787/api/federato/contract/SUB-2025-00134?format=md'
curl -s 'localhost:8787/api/federato/contract/SUB-2025-00134' | jq '.hops, .openItems, (.sections[]|select(.id=="terms"))'

# a drafted document as markdown
curl -s 'localhost:8787/api/federato/draft/1001?kind=decline&format=md'

# the agentic planner, with the full attempt trace
curl -s localhost:8787/api/federato/query -H 'content-type: application/json' \
  -d '{"goal":"claims over 100k paid indemnity grouped by cause of loss"}' | jq .

# the whole loop through the brain (announce → tool → narrate → maybe chain)
CID=$(curl -s -X POST localhost:8787/api/chat/sessions -H 'content-type: application/json' \
  -d '{"config":{"servers":{"federato":true}}}' | jq -r .chatId)
curl -s -X POST localhost:8787/api/chat/sessions/$CID/message -H 'content-type: application/json' \
  -d '{"text":"what is in the florida queue and is the top one worth quoting?"}' | jq -r '.messages[].text'
```

## What's deliberately true about the scoring

- The 2025 table is applied literally, including **renewal = Not Acceptable**. On this synthetic
  book that makes most of the queue a decline; the ranking still orders by score and the
  explanations say exactly which rule each file fails.
- Enrichment factors (National Risk Index, FEMA declarations, NFIP claims, USGS quakes, weather
  extremes, location consistency) carry stated thresholds in every `rule` string, so an underwriter
  can see how outside data moved a score. A source that fails scores "missing" (0), never a fail.
- Drafts are templated commercial terms and schedules from the record; no coverage wording is
  invented, every document is banner-marked as a draft, and the agent never sends or binds.
- The API's `over` grouping returns per-record rows; the agent collapses them into real groups
  client-side and says so in the trace.
