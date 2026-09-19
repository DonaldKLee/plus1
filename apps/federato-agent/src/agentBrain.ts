/**
 * The goose's brain: read the live meeting transcript, decide whether to act,
 * and carry the action out (post to Meet chat, speak via ElevenLabs, or call a
 * tool). Gemini does the reasoning — network-bound, so it lives here in the
 * agent, not in packages/brain (which stays pure per the project constraint).
 */

import type { Page } from "playwright-core";
import { env, envOptional } from "./env.js";
import { rankQueue } from "./rank.js";

// gemini-flash-latest currently maps to gemini-3.8-flash (only 20 free req/day).
// flash-lite-latest has far more free headroom and is plenty for classification.
const DECIDE_MODEL = process.env.GEMINI_BRAIN_MODEL || "gemini-flash-lite-latest";

export type ActionKind = "speak" | "chat" | "tool" | "none";

export interface Decision {
  act: boolean;
  action: ActionKind;
  confidence: number;
  reason: string;
  say?: string;
  chatMessage?: string;
  tool?: { name: string; query?: string };
}

const AGENT_NAME = "plus one";
/** The goose's display name in Meet; people will address it by this too. */
export const GOOSE_NAME = envOptional("GOOSE_NAME") ?? "Reginald";

const SYSTEM_PROMPT = `You are "${AGENT_NAME}", an AI teammate silently attending a live meeting as a participant.
You are given the most recent lines of the meeting transcript. Decide whether to act RIGHT NOW.

Act ONLY when it is clearly useful and welcome:
- Someone addresses you by name ("${AGENT_NAME}", "plus-one", or "${GOOSE_NAME}").
- Someone asks an open question you can directly and helpfully answer.
- A tool you have would materially help answer something just asked.
Otherwise set act=false and action="none". When in doubt, stay quiet — a silent teammate is better than a noisy one. Never react to your own previous messages.

Actions:
- "speak": say something out loud in the room. Put the words in "say".
- "chat": post a message to the meeting text chat. Put the text in "chatMessage".
- "tool": call a tool to look something up. Set tool.name and tool.query.
Available tools: federato_appetite(query) — checks underwriting appetite / whether a risk fits, given a plain-language query.

Keep spoken and chat replies to one or two natural sentences, lowercase and conversational — you talk like a colleague on a call, not a chatbot. Set confidence 0..1 for how sure you are that acting now is the right call.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    act: { type: "boolean" },
    action: { type: "string", enum: ["speak", "chat", "tool", "none"] },
    confidence: { type: "number" },
    reason: { type: "string" },
    say: { type: "string" },
    chatMessage: { type: "string" },
    tool: {
      type: "object",
      properties: {
        name: { type: "string", enum: ["federato_appetite"] },
        query: { type: "string" },
      },
    },
  },
  required: ["act", "action", "confidence", "reason"],
} as const;

/** Ask Gemini whether to act on the current transcript window. */
export async function decideAction(transcript: string): Promise<Decision> {
  const key = env("GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DECIDE_MODEL}:generateContent?key=${key}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `Recent transcript:\n${transcript}` }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  // Retry 5xx and per-minute 429s (transient). A per-DAY quota 429 won't clear
  // by retrying, so surface it as a distinct quota error.
  let res: Response | undefined;
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    const bodyText = await res.text();
    lastErr = `brain ${res.status}: ${bodyText.slice(0, 160)}`;
    if (res.status === 429 && /PerDay|RequestsPerDay/i.test(bodyText)) {
      const err = new Error("Gemini brain quota exhausted for today (free tier).") as Error & {
        quota?: boolean;
      };
      err.quota = true;
      throw err;
    }
    const transient = res.status === 429 || res.status >= 500;
    if (!transient) throw new Error(lastErr);
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    res = undefined;
  }
  if (!res) {
    const err = new Error(lastErr || "brain unavailable") as Error & { transient?: boolean };
    err.transient = true;
    throw err;
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const parsed = JSON.parse(raw) as Decision;
  return {
    act: Boolean(parsed.act),
    action: parsed.action ?? "none",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reason: parsed.reason ?? "",
    say: parsed.say,
    chatMessage: parsed.chatMessage,
    tool: parsed.tool,
  };
}

// ── Action: post to the Google Meet chat ───────────────────────────────────

export async function postToMeetChat(page: Page, message: string): Promise<boolean> {
  try {
    // Open the chat panel if it isn't already.
    const openChat = page
      .getByRole("button", { name: /chat with everyone|open chat|^chat$/i })
      .first();
    if (await openChat.isVisible().catch(() => false)) {
      await openChat.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    const box = page
      .getByRole("textbox", { name: /send a message|message everyone|chat/i })
      .first();
    await box.waitFor({ state: "visible", timeout: 4000 });
    await box.click();
    await box.fill(message);
    await page.keyboard.press("Enter");
    return true;
  } catch {
    return false;
  }
}

// Speaking is done by the LiveAvatar rig (packages/liveavatar + packages/voice): see
// speakInSession in meetTranscribe.ts. No virtual audio devices involved.

// ── Action: tools ──────────────────────────────────────────────────────────

export async function runTool(name: string, query?: string): Promise<string> {
  if (name === "federato_appetite") {
    try {
      const { ranked } = await rankQueue({ refresh: false });
      const top = ranked?.slice(0, 3) ?? [];
      if (top.length === 0) return `No Federato submissions are currently in the queue to assess${query ? ` for "${query}"` : ""}.`;
      const lines = top
        .map((r) => `${r.accountName ?? r.policyId}: ${r.decision} (score ${Math.round((r.score ?? 0) * 100) / 100})`)
        .join("; ");
      return `Top submissions by appetite${query ? ` for "${query}"` : ""}: ${lines}.`;
    } catch (e) {
      return `Could not reach Federato appetite data: ${(e as Error).message}`;
    }
  }
  return `Unknown tool: ${name}`;
}


