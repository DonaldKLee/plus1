/**
 * Dev utility for the MongoDB archive — no Meet, no Gemini, no avatar needed.
 *
 *   npm run db:check  -w @plus1/backend    connect, show what's stored
 *   npm run db:seed   -w @plus1/backend    insert three fake past meetings
 *   npm run db:clear  -w @plus1/backend    remove only the seeded meetings
 *
 * Seeded ids are prefixed `seed-` so db:clear never touches a real meeting.
 */

import {
  deleteMeeting,
  getMeeting,
  listMeetings,
  meetingStats,
  saveMeeting,
  searchMeetings,
  storeEnabled,
  closeStore,
} from "./store.js";

const SEED_IDS = ["seed-tampa", "seed-wildfire", "seed-renewal"];

function lines(texts: [string, boolean][], startedAt: number) {
  return texts.map(([text, agent], i) => ({
    id: `${startedAt}-${i}`,
    t: (i + 1) * 12_000,
    at: new Date(startedAt + (i + 1) * 12_000).toISOString(),
    text,
    ...(agent ? { agent: true, speaker: "Reginald" } : {}),
  }));
}

async function seed(): Promise<void> {
  const now = Date.now();
  const fixtures: [string, string, string, number, number, [string, boolean][]][] = [
    [
      "seed-tampa",
      "abc-defg-hij",
      "Tampa warehouse submission review",
      now - 2 * 86_400_000,
      1_920_000,
      [
        ["Let's start with the Tampa warehouse account, the one that came in Friday.", false],
        ["Coastal exposure there worries me, that's a hundred year flood zone.", false],
        ["FEMA has that parcel in zone AE, base flood elevation nine feet.", true],
        ["Then we should raise the deductible before we quote it.", false],
        ["Agreed, let's go with fifty thousand and revisit at renewal.", false],
      ],
    ],
    [
      "seed-wildfire",
      "kmn-pqrs-tuv",
      "California wildfire aggregate review",
      now - 86_400_000,
      1_140_000,
      [
        ["Wildfire exposure in California is the theme for this quarter.", false],
        ["Our aggregate in the Sierra foothills is already over appetite.", false],
        ["The queue shows eleven open submissions inside that territory.", true],
        ["Let's decline anything new above two million TIV up there.", false],
      ],
    ],
    [
      "seed-renewal",
      "wxy-zabc-def",
      "Henderson renewal decision",
      now - 3_600_000,
      780_000,
      [
        ["Quick one, the Henderson renewal is due Thursday.", false],
        ["Loss ratio has been clean for three years running.", false],
        ["No open claims on that account since 2023.", true],
        ["Then renew as is, same terms, and let the broker know today.", false],
      ],
    ],
  ];

  for (const [id, code, purpose, startedAt, durationMs, texts] of fixtures) {
    await saveMeeting({
      _id: id,
      meetUrl: `https://meet.google.com/${code}`,
      purpose,
      status: "ended",
      createdAt: new Date(startedAt).toISOString(),
      endedAt: new Date(startedAt + durationMs).toISOString(),
      durationMs,
      notes: ["Joined the room.", "Tapped 3 remote audio streams."],
      lines: lines(texts, startedAt),
      decisions: [
        {
          id: `${id}-d1`,
          t: 36_000,
          at: new Date(startedAt + 36_000).toISOString(),
          act: true,
          action: "speak",
          confidence: 0.88,
          reason: "Someone asked a factual question the plus1 could answer.",
          outcome: "spoke",
        },
      ],
    });
    console.log(`  seeded ${id}`);
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "check";

  if (!storeEnabled()) {
    console.error(
      "MONGODB_URI is not set — add it to .env first, or the archive stays in memory only.",
    );
    process.exit(1);
  }

  if (mode === "seed") {
    console.log("Seeding fake past meetings…");
    await seed();
  }

  if (mode === "clear") {
    for (const id of SEED_IDS) {
      const removed = await deleteMeeting(id);
      console.log(`  ${removed ? "removed" : "not found"} ${id}`);
    }
  }

  const stored = await listMeetings();
  console.log(`\nStored meetings (${stored.length}):`);
  for (const m of stored) {
    const mins = m.durationMs ? `${Math.round(m.durationMs / 60000)} min` : "—";
    console.log(`  ${m.id}  ${m.status.padEnd(7)}  ${m.lineCount} lines  ${mins}  ${m.createdAt}`);
  }

  console.log("\nStats:", await meetingStats());

  const q = process.env.Q ?? "deductible";
  const hits = await searchMeetings(q);
  console.log(`\nText search for "${q}" → ${hits.length} hit(s):`);
  for (const h of hits) console.log(`  ${h.id}: ${h.snippet ?? "(matched, no snippet)"}`);

  const first = stored[0];
  if (first) {
    const doc = await getMeeting(first.id);
    console.log(
      `\nRound-trip ${first.id}: ${doc?.lines.length} lines, ${doc?.decisions.length} decisions saved.`,
    );
  }

  await closeStore();
}

main().catch(async (e) => {
  console.error(e);
  await closeStore();
  process.exit(1);
});
