/** `npm run avatars` / `npm run voices` — print the catalogue so you can pick IDs for .env. */
import { loadEnv } from "../src/env.js";
loadEnv(import.meta.url);
import { LiveAvatarClient } from "../src/client.js";

const apiKey = process.env.LIVEAVATAR_API_KEY;
if (!apiKey) { console.error("set LIVEAVATAR_API_KEY"); process.exit(2); }
const client = new LiveAvatarClient({ apiKey });
const what = process.argv[2] ?? "avatars";

if (what === "avatars") {
  const [pub, mine] = await Promise.all([client.listPublicAvatars(), client.listUserAvatars().catch(() => [])]);
  const rows = [...mine.map((a) => ({ ...a, scope: "mine" })), ...pub.map((a) => ({ ...a, scope: "public" }))];
  console.table(rows.map((a) => ({ scope: a.scope, id: a.id, name: a.name, type: a.type, status: a.status, voice: a.default_voice?.name ?? "-" })));
} else if (what === "voices") {
  const voices = await client.listVoices();
  console.table(voices.map((v) => ({ id: v.id, name: v.name, language: v.language, gender: v.gender, tags: (v.tags ?? []).join(",") })));
} else {
  console.error("usage: list.ts avatars|voices");
  process.exit(2);
}
