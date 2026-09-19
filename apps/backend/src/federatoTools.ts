/**
 * Federato, exposed to the goose as tools it can call live in a meeting or chat:
 *   - federato_appetite(query?) — the queue ranked by appetite (quote/refer/decline)
 *   - federato_account(query)   — deep-dive one account/policy: decision, why, red flags
 *
 * Direct-client tools (like the rest of Federato here), not an external MCP.
 * Results are short, spoken-friendly strings; the meeting/chat relays them.
 */
import { rankQueue } from "./rank.js";
import { deepDivePolicy } from "./deepDive.js";

const num2 = (n: number | null | undefined) =>
  typeof n === "number" ? Math.round(n * 100) / 100 : null;

async function appetite(query?: string): Promise<string> {
  const { ranked } = await rankQueue({ refresh: false });
  if (!ranked || ranked.length === 0) return "the Federato queue is empty right now.";

  let list = ranked;
  const q = query?.trim().toLowerCase();
  if (q) {
    const hits = ranked.filter(
      (r) =>
        (r.accountName ?? "").toLowerCase().includes(q) ||
        (r.lineOfBusiness ?? "").toLowerCase().includes(q) ||
        r.decision.toLowerCase().includes(q),
    );
    if (hits.length) list = hits;
  }

  const top = list.slice(0, 4).map((r) => {
    const who = r.accountName ?? r.policyNumber ?? `policy ${r.policyId}`;
    const score = num2(r.score);
    const max = num2(r.maxScore);
    const s = score != null ? ` (${score}${max != null ? `/${max}` : ""})` : "";
    return `${who} — ${r.decision}${s}`;
  });

  const lead = q ? `for "${query}": ` : `top of the queue by appetite: `;
  return `${lead}${top.join("; ")}.`;
}

async function account(query?: string): Promise<string> {
  const q = query?.trim();
  if (!q) return "which account or policy? give me a name or a policy number.";

  // A number in the request → treat as a policy id; otherwise match by account name.
  let policyId: number | null = null;
  const numMatch = q.match(/\d{3,}/);
  if (numMatch) {
    policyId = Number(numMatch[0]);
  } else {
    const { ranked } = await rankQueue({ refresh: false });
    const hit = ranked?.find((r) => (r.accountName ?? "").toLowerCase().includes(q.toLowerCase()));
    policyId = hit?.policyId ?? null;
    if (policyId == null) return `couldn't find an account matching "${q}" in the queue.`;
  }

  try {
    const { deepDive } = await deepDivePolicy(policyId);
    const firstSentence = (deepDive.explanation || "").split(/(?<=\.)\s/)[0] || deepDive.explanation || "";
    const flags = (deepDive.contradictionNotes ?? []).slice(0, 2);
    const flagLine = flags.length ? ` red flags: ${flags.join("; ")}` : "";
    return `${deepDive.accountName}: ${deepDive.decision.toUpperCase()}. ${firstSentence}${flagLine}`;
  } catch (e) {
    return `couldn't pull that account: ${(e as Error).message}`;
  }
}

/** Dispatch a federato_* tool. Returns a short result string for the room. */
export async function runFederatoTool(name: string, args: { query?: string }): Promise<string> {
  if (name === "federato_appetite") return appetite(args.query);
  if (name === "federato_account") return account(args.query);
  return `Unknown Federato tool: ${name}`;
}
