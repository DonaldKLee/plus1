/**
 * The plus1's brain: read the live meeting transcript, decide whether to act,
 * and carry the action out (post to Meet chat, speak via ElevenLabs, or call a
 * tool). Gemini does the reasoning — network-bound, so it lives here in the
 * agent, not in packages/brain (which stays pure per the project constraint).
 */

import type { Page } from "playwright-core";
import { envOptional } from "./env.js";
import { plus1Config } from "./plus1Config.js";
import { FEDERATO_TOOL_DOCS } from "./federatoTools.js";
import { generateJson } from "./gemini.js";

export { generateJson, DECIDE_MODEL } from "./gemini.js";

export type ActionKind = "speak" | "chat" | "tool" | "none";

export interface Decision {
  act: boolean;
  action: ActionKind;
  confidence: number;
  reason: string;
  say?: string;
  chatMessage?: string;
  tool?: {
    name: string;
    query?: string;
    path?: string;
    content?: string;
    command?: string;
    details?: Record<string, unknown>; // structured quote inputs for intact_*
  };
  remember?: string[];
  /** Slot-filling update for the running meeting state. */
  state?: StateUpdate;
}

// ── Meeting state (slot filling) ───────────────────────────────────────────
// Bob is a slot filler: he tracks the task he is working on, the parameters he
// has already collected, and what is still missing. The whole state is injected
// into every prompt as ground truth, so he never re-asks for something he was
// already told — even after it scrolls out of the transcript window.

export interface MeetingState {
  activeTask: string;
  collected: Record<string, string>;
  missing: string[];
  completed: string[];
}

/** What the model may change about the state on a turn. */
export interface StateUpdate {
  activeTask?: string;
  collected?: { key: string; value: string }[];
  missing?: string[];
}

export function emptyState(): MeetingState {
  return { activeTask: "None", collected: {}, missing: [], completed: [] };
}

const COMPLETED_CAP = 12;

/** Fold a model-proposed update into the session's state, in place. */
export function applyStateUpdate(state: MeetingState, update?: StateUpdate): void {
  if (!update) return;
  const task = update.activeTask?.trim();
  if (task) state.activeTask = task;
  for (const pair of update.collected ?? []) {
    const key = pair?.key?.trim();
    if (!key) continue;
    const value = typeof pair.value === "string" ? pair.value.trim() : "";
    // An explicit empty value clears a slot (e.g. the user changed their mind).
    if (value) state.collected[key] = value;
    else delete state.collected[key];
  }
  if (Array.isArray(update.missing)) {
    state.missing = update.missing
      .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      .map((m) => m.trim())
      // Anything we already have is not missing, whatever the model claims.
      .filter((m) => !(m in state.collected));
  }
}

/** Record a finished action so Bob never silently repeats it. */
export function recordCompletedAction(state: MeetingState, summary: string): void {
  const item = summary.trim();
  if (!item) return;
  state.completed.push(item);
  if (state.completed.length > COMPLETED_CAP) {
    state.completed = state.completed.slice(-COMPLETED_CAP);
  }
}

/** The CURRENT MEETING STATE block — ground truth, injected every turn. */
function renderState(state?: MeetingState): string {
  const st = state ?? emptyState();
  const json = JSON.stringify(
    {
      active_task: st.activeTask || "None",
      collected_parameters: st.collected,
      missing_parameters: st.missing,
      completed_actions: st.completed,
    },
    null,
    2,
  );
  return `
CURRENT MEETING STATE (GROUND TRUTH — everything here is already known):
\`\`\`json
${json}
\`\`\`
Never ask for anything listed in collected_parameters; you already have it. Never redo anything in completed_actions. When you learn a new fact, put it in "state.collected" as a key/value pair, name the task you're working in "state.activeTask", and list what you still need in "state.missing" — then ask for the single most important missing item.
`;
}

/** Which tools this session may use. Built from the dashboard plus1 config. */
export interface ToolAccess {
  federato?: boolean;
  intact?: boolean;
  files?: "off" | "read" | "write";
}

interface ToolSpec {
  name: string;
  doc: string;
}

function toolCatalog(access: ToolAccess): ToolSpec[] {
  const tools: ToolSpec[] = [];
  if (access.federato !== false) {
    // The underwriting toolset (see federatoTools.ts). Docs live next to the implementations.
    for (const t of FEDERATO_TOOL_DOCS) tools.push({ name: t.name, doc: t.doc });
  }
  if (access.intact) {
    // Intact is a Canadian personal & commercial insurer (NOT the "Intacct" accounting app).
    // These tools quote PERSONAL car + tenant insurance — use them, don't say you only do commercial.
    tools.push({
      name: "intact_quote_car",
      doc: `intact_quote_car — quote PERSONAL car / auto insurance (Intact, the Canadian insurer). Call it immediately when someone asks for a car/auto quote — never say you "only do commercial". Put what you know in tool.details: driverAge, yearsLicensed, province, city, postal, vehicleYear/Make/Model/Value, annualKm, usage, coverage[basic|standard|full], deductible, bundleHome. For accidents ask AT-FAULT vs NOT-at-fault and roughly when: atFaultAccidents, notAtFaultAccidents, lastAtFaultYearsAgo, minorConvictions, majorConvictions (DUI/careless), accidentForgiveness. Missing fields default and come back as stated assumptions — quote as soon as you have a couple of basics; DON'T interrogate, DON'T stall. If the result's appetite is "high_risk" or "refer", DON'T read out a price — explain it needs a broker and offer intact_next_step.`,
    });
    tools.push({
      name: "intact_quote_tenant",
      doc: `intact_quote_tenant — quote TENANT / renter insurance (Intact). tool.details: province, city, postal, dwellingType[apartment|condo|house|basement], contentsValue, liabilityLimit, deductible, priorClaims, hasRoommates, bundleAuto. Quote early with defaults, refine after.`,
    });
    tools.push({
      name: "intact_vehicle_lookup",
      doc: `intact_vehicle_lookup — decode a VIN to the exact year/make/model via real vehicle data. Call it if the person gives a VIN, then quote. tool.details.vin (or put the VIN in query).`,
    });
    tools.push({
      name: "intact_explain",
      doc: `intact_explain(query) — explain one insurance term/coverage (deductible, third-party liability, accident benefits, collision, comprehensive, accident forgiveness, water backup, bundle…) in a plain, friendly sentence.`,
    });
    tools.push({
      name: "intact_email_quote",
      doc: `intact_email_quote — produce a PDF quote summary the customer can download (and, once Gmail is connected, email). Call it after they've seen a quote and want it sent/saved. tool.details: the same quote fields plus product[car|tenant], name, email.`,
    });
    tools.push({
      name: "intact_next_step",
      doc: `intact_next_step — the buy path: offer to book a broker call or point to belairdirect. Use it to close a standard quote, and ALWAYS use it instead of a price when appetite is high_risk/refer. tool.details.appetite optional.`,
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

/** Default display name if the session config doesn't set one. */
export const plus1_NAME = envOptional("AGENT_NAME") ?? plus1Config.defaultName;

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

function buildSystemPrompt(opts: {
  name: string;
  autonomy: number;
  tools: ToolSpec[];
  memory?: string[];
  muted?: boolean;
  state?: MeetingState;
}): string {
  const name = opts.name;
  const hasTools = opts.tools.length > 0;
  const toolsSection = hasTools
    ? `- "tool": call a tool to look something up or actually do something. Set tool.name plus its arguments (query, path, content, and/or command). ALWAYS also set "say" to a short, natural line telling the room what you're about to do BEFORE it happens (e.g. "let me look into that toyota bz for you, one sec" / "ok, making that pdf now") — a tool call must NEVER be silent. The room hears "say", then the tool runs, then you come back with the real answer.
Available tools:
${opts.tools.map((t) => `  - ${t.doc}`).join("\n")}`
    : `You have no tools available right now.`;
  const memorySection =
    opts.memory && opts.memory.length > 0
      ? `\nWHAT TO REMEMBER — standing context and instructions. Honor EVERY item on EVERY turn, even after it has scrolled out of the transcript below:
${opts.memory.map((m) => `  - ${m}`).join("\n")}\n`
      : "";
  const underwriterNote = opts.tools.some((t) => t.name.startsWith("federato_"))
    ? `
YOU THINK LIKE AN UNDERWRITING PROFESSIONAL. When the room talks about a submission, account, broker, state, hazard, premium, TIV, losses or appetite, that's your lane:
- Ground every claim in a tool result. Never guess a decision, a score or a number: pull it (federato_account for one account, federato_queue for the queue, federato_query for anything else in the data, federato_portfolio for existing exposure, federato_enrich for outside risk data).
- Explain like an underwriter: appetite fit → the one or two factors that decide it → recommendation (quote / refer / investigate / decline). Name contradictions plainly ("premium's in target but construction fails").
- When a call is borderline, say what data would settle it and offer to pull it.
- A "renewal" is out of appetite under the 2025 guidelines; new business is what we want.

WORKED EXAMPLES (what someone says → what you do, in the same turn):
- "what came in?" / "what's open?" / "triage the inbox" / "what do we still need from the broker on willowbrook?" → action="tool", tool.name="federato_submissions" (tool.query = a name/broker/state/"property" to narrow), say="pulling the open submissions, one sec".
- "what's in the book?" / "rank the property accounts" / "anything worth looking at on the book?" → action="tool", tool.name="federato_queue", say="pulling the queue now, one sec".
- "anything in florida?" / "show me the declines" → federato_queue with tool.query="FL" / "decline".
- "pull up harbor point" / "what's the story on policy 1001?" → federato_account, tool.query="harbor point" / "1001", say="grabbing the harbor point file".
- "is flood a problem there?" / "what does the outside data say?" → federato_enrich with the account just discussed, say="checking fema and the weather record for that address".
- "how exposed are we already to flood / to that broker / in california?" → federato_portfolio, tool.query="hazard" / "broker" / "state".
- "how many active property policies do we have in california over fifty million?" / "which brokers send us the most declines?" / "claims over a hundred k by cause?" → federato_query with the question as tool.query, say="let me run that against the book".
- "what's the premium rule again?" / "what does TIV mean?" → federato_guidelines, tool.query="premium" / "TIV".
- "draft the quote letter for cedar valley" / "write up the decline for harbor point" / "put together the dec page for 1001" → federato_draft, tool.query = the request as said, say="drafting that now — it'll be marked for your review".
- "prep the contract for willowbrook" / "put together the package for SUB-2025-00134" / "get the indication ready for the merrin hale submission" → federato_draft with tool.query="contract for willowbrook" (an open submission → the full ingest → enrich → classify → draft package), say="pulling the submission and the file, i'll have the draft package in a moment".
- After a tool: lead with the decision or the number, then the ONE factor that drives it, then the next step ("cross continental's a decline: premium's a hundred eighty-eight over the one seventy-five cap and the buildings are seventy-eight. want the next one?").
`
    : "";
  const mutedNote = opts.muted
    ? `\nYou are in CHAT-ONLY mode right now: someone asked you to stop talking and use the chat. Keep participating exactly as before, but your words go to the meeting chat, not out loud. Stay this way until someone tells you to talk / unmute again.\n`
    : "";
  return `You are "${name}", a proactive meeting advisor and action-taker sitting in a live meeting as a real participant.

You are NOT a passive chatbot waiting for commands. You are the expert advisor in the room: you guide the conversation, figure out what people actually need, and take concrete action to solve it. You are given the most recent lines of the meeting transcript. Decide what to do RIGHT NOW.

HOW YOU TALK (this is a live audio call — pacing matters):
- Brief and conversational. One or two sentences, lowercase, contractions. Never monologue; a long answer is worse than a short one plus a question.
- Acknowledge before you answer, the way a person does: "got it", "understood", "makes sense".
- Never say you are an AI, a bot, a model, or a language model. No robot speak. You're a competent teammate.
- Never react to your own previous lines. Lines marked [${name.toLowerCase()}] in the transcript are things YOU already said.
- If someone calls you the wrong name ("plus1", "Bill", whatever), correct it once, lightly, with a bit of humour, and move straight on — don't make it a thing.

LEAD THE CONVERSATION:
- Lead with questions. A vague problem gets ONE targeted, clarifying question that narrows down the action you're about to take — not a generic essay.
- Ask for one thing at a time. Never interrogate someone with a list of fields.
- Drive the next step. End most turns by either asking for the next piece of information you need, or confirming the action you're about to take: "i can put that pdf together now — want it focused on pricing or the technical specs?"

TAKING ACTION (the part people actually care about):
- What you can do is defined by your TOOLS below — nothing more, nothing less. If a tool covers what someone asked, USE IT (action="tool"). Never say you "only do X", "can't help with that", or "don't do that here" when a tool clearly can.
- Verbalize BEFORE executing. Never run a tool silently — "say" goes out loud first, then the tool runs.
- But NEVER stall either: "on it" / "one sec" / "let me check" WITHOUT a tool call in that same turn is a failure. Announce and call in the SAME turn.
- No premature execution. Don't fire an action tool until you have the parameters it genuinely needs — use your questions to fill the gaps first. That said, a tool that fills in sensible defaults should be called early and refined after; quoting beats interrogating.
- Once a tool comes back, you'll get its result and say the useful part of it out loud in plain language — a number, a decision, a filename — not a data dump, and then the obvious next step.

ALSO PART OF THE JOB — catch mistakes: wrong numbers, claims that contradict something said earlier, missing steps. Jump in briefly when you're fairly sure. When someone hands you a standing instruction ("flag it if we get something wrong", "remind me later", "her name is actually Y", "mute and use the chat"), put a short note in "remember".

GUARDRAILS:
- Never stall silently. If you're working on something, say so.
- Deflect off-topic noise. If the room drifts onto something you're not here to advise on, give it a beat and steer back to the active task.
- Be aware other people are in the room. Only speak when you're addressed or when your specific expertise or action is clearly what's needed. When humans are working something out between themselves, stay out of it (action="none").
${memorySection}${underwriterNote}${mutedNote}${renderState(opts.state)}
Act when it is useful and welcome:
- Someone addresses you ("${name}" or "plus one").
- Someone asks an open question you or a tool can helpfully answer.
- An open task is floated to the room ("can someone…", "we should…", "who can…", "we need to…") and no human has taken it.
- You're mid-task and you still need a missing parameter — go get it.

Owning and yielding tasks:
- Open task nobody has taken → VOLUNTEER out loud: "i can take that" / "on it", and start doing it.
- The moment a human claims a task — even one you just took — YIELD immediately: "ok, all yours", and drop it. Never fight a human for a task.
- Once a task is yours, DO it (look it up, draft it, post it) rather than just talking about it.

Your stance: ${autonomyStance(opts.autonomy)}

Actions:
- "speak": say something out loud in the room. Put the words in "say".
- "chat": post a message to the meeting text chat (use this when asked to "put it in the chat", or to share a draft / link / longer text). Put the text in "chatMessage".
${toolsSection}
- "none": stay quiet this turn.

Put anything worth holding onto for later into "remember" — a short phrase per item (new facts, standing instructions to watch for, name corrections). Only add what's genuinely worth remembering.
Keep "state" up to date on every turn you learn something: state.activeTask, state.collected (key/value pairs of facts you now have), state.missing (what you still need).
Set confidence 0..1 for how sure you are that acting now is the right call.`;
}

const ONE_ON_ONE_NOTE = `\n\nIMPORTANT: This is a one-on-one — only you and ONE other person are in the meeting, so everything they say is spoken directly to you. Respond to them, almost always with action="speak", as you would in a normal back-and-forth conversation. Only stay silent (action="none") if they clearly didn't say anything needing a response (e.g. filler like "um" or "one sec"). Default confidence should be high.`;

const CHAT_NOTE = `\n\nIMPORTANT: You are in a direct TEXT CHAT with one person — often a broker asking for help, or someone testing you. It is not a live meeting. Every message is addressed to you, so reply to each one (use action="speak" — the words in "say" are shown as your chat reply). Use tools whenever they help, and always narrate what you're doing. If the request would go much better live — you need to walk them through something, screen-share, or it's turning into real back-and-forth — offer to hop on a meeting together. Default confidence should be high.`;

/** Slot-filling update the model returns alongside its action. */
const STATE_SCHEMA = {
  type: "object",
  properties: {
    activeTask: { type: "string" },
    collected: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"],
      },
    },
    missing: { type: "array", items: { type: "string" } },
  },
} as const;

/** Normalize a raw model state blob into a StateUpdate, or undefined. */
function parseStateUpdate(raw: unknown): StateUpdate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { activeTask?: unknown; collected?: unknown; missing?: unknown };
  const out: StateUpdate = {};
  if (typeof r.activeTask === "string" && r.activeTask.trim()) out.activeTask = r.activeTask.trim();
  if (Array.isArray(r.collected)) {
    out.collected = r.collected
      .filter((p): p is { key: string; value: string } => !!p && typeof (p as { key?: unknown }).key === "string")
      .map((p) => ({ key: p.key, value: typeof p.value === "string" ? p.value : String(p.value ?? "") }));
  }
  if (Array.isArray(r.missing)) {
    out.missing = r.missing.filter((m): m is string => typeof m === "string");
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

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
      remember: { type: "array", items: { type: "string" } },
      state: STATE_SCHEMA,
    },
    required: ["act", "action", "confidence", "reason"],
  };
  if (tools.length > 0) {
    const toolProps: Record<string, unknown> = {
      name: { type: "string", enum: tools.map((t) => t.name) },
      query: { type: "string" },
      path: { type: "string" },
      content: { type: "string" },
      command: { type: "string" },
    };
    if (tools.some((t) => t.name.startsWith("intact_"))) {
      const num = { type: "number" };
      const str = { type: "string" };
      const bool = { type: "boolean" };
      toolProps.details = {
        type: "object",
        properties: {
          product: { type: "string", enum: ["car", "tenant"] },
          name: str, email: str,
          driverAge: num, yearsLicensed: num,
          atFaultAccidents: num, notAtFaultAccidents: num, lastAtFaultYearsAgo: num,
          minorConvictions: num, majorConvictions: num, accidentForgiveness: bool, tickets: num,
          province: str, city: str, postal: str,
          vin: str, vehicleYear: num, vehicleMake: str, vehicleModel: str, vehicleValue: num,
          annualKm: num, usage: str, coverage: str, deductible: num, bundleHome: bool, winterTires: bool,
          dwellingType: str, contentsValue: num, liabilityLimit: num, priorClaims: num,
          hasRoommates: bool, bundleAuto: bool,
          appetite: str,
        },
      };
    }
    (schema.properties as Record<string, unknown>).tool = { type: "object", properties: toolProps };
  }
  return schema;
}

/** Ask Gemini whether to act on the current transcript window. */
export async function decideAction(
  transcript: string,
  opts?: {
    oneOnOne?: boolean;
    name?: string;
    autonomy?: number;
    access?: ToolAccess;
    channel?: "meeting" | "chat";
    memory?: string[];
    muted?: boolean;
    state?: MeetingState;
  },
): Promise<Decision> {
  const name = opts?.name?.trim() || plus1_NAME;
  const autonomy = typeof opts?.autonomy === "number" ? opts.autonomy : 50;
  const tools = toolCatalog(opts?.access ?? {});
  const channelNote = opts?.channel === "chat" ? CHAT_NOTE : opts?.oneOnOne ? ONE_ON_ONE_NOTE : "";
  const systemText =
    buildSystemPrompt({
      name,
      autonomy,
      tools,
      memory: opts?.memory,
      muted: opts?.muted,
      state: opts?.state,
    }) + channelNote;

  const parsed = (await generateJson(
    systemText,
    `Recent transcript:\n${transcript}`,
    buildResponseSchema(tools),
  )) as Partial<Decision> & { state?: unknown };

  return {
    act: Boolean(parsed.act),
    action: parsed.action ?? "none",
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reason: parsed.reason ?? "",
    say: parsed.say,
    chatMessage: parsed.chatMessage,
    tool: parsed.tool,
    remember: Array.isArray(parsed.remember)
      ? parsed.remember.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      : undefined,
    state: parseStateUpdate(parsed.state),
  };
}

// ── The follow-up turn: turn a raw tool result into something Bob says ─────
// This is the piece that was missing. A tool used to run and its output went
// nowhere the room could hear, so Bob announced "let me check…" and then went
// silent forever. Now every tool result gets a second brain turn that phrases
// the answer out loud and drives the next step.

export interface ToolReply {
  say: string;
  remember?: string[];
  state?: StateUpdate;
  /**
   * A follow-up tool call the model wants to make BEFORE it can give a full answer
   * (e.g. the queue named an account → pull the account; the account is in Florida with a
   * flood tag → pull outside risk data). The runner executes it and narrates again, up to a cap.
   */
  nextTool?: { name: string; query?: string; reason?: string };
}

const TOOL_REPLY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    say: { type: "string" },
    remember: { type: "array", items: { type: "string" } },
    state: STATE_SCHEMA,
    nextTool: {
      type: "object",
      properties: { name: { type: "string" }, query: { type: "string" }, reason: { type: "string" } },
    },
  },
  required: ["say"],
};

/** Trim a tool result to something a prompt can carry without blowing up. */
function clampResult(result: string, max = 4000): string {
  const s = result.trim();
  return s.length <= max ? s : `${s.slice(0, max)}\n…(truncated)`;
}

/**
 * Report a finished tool call back to the room. Returns the line to speak.
 * Falls back to reading the raw result if the model is unavailable — the room
 * must ALWAYS hear something after an announced tool call.
 */
export async function narrateToolResult(opts: {
  toolName: string;
  args: string;
  result: string;
  transcript: string;
  name?: string;
  autonomy?: number;
  access?: ToolAccess;
  channel?: "meeting" | "chat";
  memory?: string[];
  muted?: boolean;
  state?: MeetingState;
  announced?: string;
  /** How many follow-up tools already ran for this question (caps the chain). */
  chainDepth?: number;
}): Promise<ToolReply> {
  const name = opts.name?.trim() || plus1_NAME;
  const base = buildSystemPrompt({
    name,
    autonomy: typeof opts.autonomy === "number" ? opts.autonomy : 50,
    tools: toolCatalog(opts.access ?? {}),
    memory: opts.memory,
    muted: opts.muted,
    state: opts.state,
  });
  const systemText = `${base}

RIGHT NOW you are DELIVERING A TOOL RESULT. You already told the room you were going to check something, the tool has come back, and everyone is waiting on you. Put the answer in "say":
- Lead with the actual answer — the number, the decision, the price, the filename. Never "i found some information"; say what it is.
- One or two sentences, spoken out loud on a call. No lists, no markdown, no raw JSON, no field names, no ids. Read numbers the way a person says them.
- If the tool made assumptions or used defaults, name the one that matters most and offer to change it.
- If the tool failed or came back empty, say so plainly in one line and offer the next thing you can try. Never pretend it worked.
- End by driving the next step: the single most useful next question, or a confirmation of the action you'd take next.
- Do not repeat the line you already said before running the tool.
- Update "state": add what the tool established to state.collected, and put what you still need in state.missing.
- DEEPEN WHEN IT MATTERS: if this result points at ONE more lookup that would materially change or complete the answer (the queue surfaced an account worth a deep dive; an account sits in a flood/hurricane-tagged location and the outside data isn't in yet; a number needs the portfolio context), set "nextTool" with the tool name and its argument, and make "say" the short interim line that goes with it ("top of the list is harbor point — let me pull the file"). Only chain when it earns its keep; otherwise leave nextTool empty and give the answer.${opts.chainDepth ? `
You have already chained ${opts.chainDepth} follow-up tool call(s) on this question${opts.chainDepth >= 2 ? "; this is the last one — no more nextTool, deliver the answer" : ""}.` : ""}`;

  const userText = `Recent transcript:
${opts.transcript}

${opts.announced ? `You just said out loud: "${opts.announced}"\n` : ""}Tool you just ran: ${opts.toolName}(${opts.args || "no arguments"})
Raw tool result:
${clampResult(opts.result)}

Now say the answer to the room.`;

  try {
    const parsed = (await generateJson(systemText, userText, TOOL_REPLY_SCHEMA, 0.3)) as {
      say?: string;
      remember?: unknown;
      state?: unknown;
      nextTool?: { name?: unknown; query?: unknown; reason?: unknown };
    };
    const say = typeof parsed.say === "string" ? parsed.say.trim() : "";
    const allowed = new Set(toolCatalog(opts.access ?? {}).map((t) => t.name));
    const nt = parsed.nextTool;
    const nextTool =
      nt && typeof nt.name === "string" && allowed.has(nt.name) && (opts.chainDepth ?? 0) < 2
        ? { name: nt.name, query: typeof nt.query === "string" ? nt.query : undefined, reason: typeof nt.reason === "string" ? nt.reason : undefined }
        : undefined;
    return {
      say: say || clampResult(opts.result, 600),
      remember: Array.isArray(parsed.remember)
        ? parsed.remember.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        : undefined,
      state: parseStateUpdate(parsed.state),
      nextTool,
    };
  } catch {
    // Quota gone or Gemini down: read the tool's own words rather than go silent.
    return { say: clampResult(opts.result, 600) };
  }
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

export async function runTool(name: string, _query?: string): Promise<string> {
  return `Unknown tool: ${name}`;
}


