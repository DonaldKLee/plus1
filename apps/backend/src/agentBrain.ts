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
  tool?: { name: string; query?: string; path?: string; content?: string; command?: string };
}

/** Which tools this session may use. Built from the dashboard Goose config. */
export interface ToolAccess {
  federato?: boolean;
  files?: "off" | "read" | "write";
}

interface ToolSpec {
  name: string;
  doc: string;
}

function toolCatalog(access: ToolAccess): ToolSpec[] {
  const tools: ToolSpec[] = [];
  if (access.federato !== false) {
    tools.push({
      name: "federato_appetite",
      doc: `federato_appetite(query) — checks underwriting appetite / whether a risk fits, given a plain-language query.`,
    });
  }
  if (access.files === "read" || access.files === "write") {
    tools.push({ name: "list_files", doc: `list_files(path?) — list files in the team's shared folder (path optional).` });
    tools.push({ name: "read_file", doc: `read_file(path) — read a text file from the shared folder.` });
  }
  if (access.files === "write") {
    tools.push({ name: "write_file", doc: `write_file(path, content) — save text to a file in the shared folder (e.g. notes, action items, a draft).` });
    tools.push({
      name: "run_command",
      doc: `run_command(command) — run a shell command on the user's machine to actually get something done that the file tools can't (create a PDF, convert a file, open an app, etc). Set tool.command to the exact bash command.`,
    });
  }
  return tools;
}

const AGENT_NAME = "goose";
/** Default display name if the session config doesn't set one. */
export const GOOSE_NAME = envOptional("GOOSE_NAME") ?? "Goose";

/** 0 = pure notetaker, 100 = eager action-taker. */
function autonomyStance(autonomy: number): string {
  if (autonomy < 34) {
    return `You lean toward LISTENING. Only act when you are directly addressed or asked something specific. Otherwise stay quiet (action="none").`;
  }
  if (autonomy < 67) {
    return `You are BALANCED. Help when it's clearly useful. In a group, give people a beat to answer before you jump in, and never talk over a decision humans are making.`;
  }
  return `You are PROACTIVE. Speak up whenever you can genuinely help, volunteer for open tasks, and treat a group like a normal back-and-forth — but always defer instantly to a human who wants to take something.`;
}

function buildSystemPrompt(opts: { name: string; autonomy: number; tools: ToolSpec[] }): string {
  const name = opts.name;
  const hasTools = opts.tools.length > 0;
  const toolsSection = hasTools
    ? `- "tool": call a tool to look something up or act. Set tool.name plus its arguments (query, path, content, and/or command). ALWAYS also set "say" to a short, natural line telling the room what you're about to do BEFORE it happens (e.g. "let me check the downloads folder" / "one sec, making that pdf now") — a tool call must never be silent.
Available tools:
${opts.tools.map((t) => `  - ${t.doc}`).join("\n")}`
    : `You have no tools available right now.`;
  return `You are "${name}", an AI teammate attending a live meeting as a real participant — not a bot.
You are given the most recent lines of the meeting transcript. Decide what to do RIGHT NOW.

Talk like a colleague on a call: warm, brief, lowercase, one or two sentences, contractions. Never sound like a chatbot. Never react to your own previous messages.

Act when it is useful and welcome:
- Someone addresses you ("${name}", "goose", or "plus one").
- Someone asks an open question you or a tool can helpfully answer.
- An open task is floated to the room ("can someone…", "we should…", "who can…", "we need to…") and no human has taken it.

Owning and yielding tasks (this is what makes you feel human):
- Open task nobody has taken → VOLUNTEER out loud: "i can take that" / "on it", and start doing it.
- The moment a human claims a task — even one you just took — YIELD immediately: "ok, all yours", and drop it. Never fight a human for a task.
- If humans are sorting out who does something, stay out of it (action="none").
- Once a task is yours, DO it (look it up, draft it, post it) rather than just talking about it.

Your stance: ${autonomyStance(opts.autonomy)}

Actions:
- "speak": say something out loud in the room. Put the words in "say".
- "chat": post a message to the meeting text chat (use this when asked to "put it in the chat", or to share a draft / link / longer text). Put the text in "chatMessage".
${toolsSection}

Set confidence 0..1 for how sure you are that acting now is the right call.`;
}

const ONE_ON_ONE_NOTE = `\n\nIMPORTANT: This is a one-on-one — only you and ONE other person are in the meeting, so everything they say is spoken directly to you. Respond to them, almost always with action="speak", as you would in a normal back-and-forth conversation. Only stay silent (action="none") if they clearly didn't say anything needing a response (e.g. filler like "um" or "one sec"). Default confidence should be high.`;

const CHAT_NOTE = `\n\nIMPORTANT: You are in a direct TEXT CHAT with one person — often a broker asking for help, or someone testing you. It is not a live meeting. Every message is addressed to you, so reply to each one (use action="speak" — the words in "say" are shown as your chat reply). Use tools whenever they help, and always narrate what you're doing. If the request would go much better live — you need to walk them through something, screen-share, or it's turning into real back-and-forth — offer to hop on a meeting together. Default confidence should be high.`;

function buildResponseSchema(tools: ToolSpec[]) {
  const actions = tools.length > 0 ? ["speak", "chat", "tool", "none"] : ["speak", "chat", "none"];
  const schema: Record<string, unknown> = {
    type: "object",
    properties: {
      act: { type: "boolean" },
      action: { type: "string", enum: actions },
      confidence: { type: "number" },
      reason: { type: "string" },
      say: { type: "string" },
      chatMessage: { type: "string" },
    },
    required: ["act", "action", "confidence", "reason"],
  };
  if (tools.length > 0) {
    (schema.properties as Record<string, unknown>).tool = {
      type: "object",
      properties: {
        name: { type: "string", enum: tools.map((t) => t.name) },
        query: { type: "string" },
        path: { type: "string" },
        content: { type: "string" },
        command: { type: "string" },
      },
    };
  }
  return schema;
}

/** Ask Gemini whether to act on the current transcript window. */
export async function decideAction(
  transcript: string,
  opts?: { oneOnOne?: boolean; name?: string; autonomy?: number; access?: ToolAccess; channel?: "meeting" | "chat" },
): Promise<Decision> {
  const key = env("GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DECIDE_MODEL}:generateContent?key=${key}`;
  const name = opts?.name?.trim() || GOOSE_NAME;
  const autonomy = typeof opts?.autonomy === "number" ? opts.autonomy : 50;
  const tools = toolCatalog(opts?.access ?? {});
  const channelNote = opts?.channel === "chat" ? CHAT_NOTE : opts?.oneOnOne ? ONE_ON_ONE_NOTE : "";
  const systemText = buildSystemPrompt({ name, autonomy, tools }) + channelNote;
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts: [{ text: `Recent transcript:\n${transcript}` }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(tools),
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


