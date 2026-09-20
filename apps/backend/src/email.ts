/**
 * Email transport for the plus1 — SMTP via nodemailer.
 *
 * WHY SMTP AND NOT THE GMAIL API: there is no Google OAuth anywhere in this
 * repo. The only Google credential is a persistent, hand-signed-in Chrome
 * profile that Playwright drives to join Meet (meetPresent.ts). That is a
 * browser session, not an API token, and it can't be exchanged for one. SMTP
 * with an app password needs no consent screen, no token refresh, and no
 * callback URL, and works with Gmail, Fastmail, Postmark, Resend, SES — anything
 * with a host and a password. If you later want the Gmail API, `deliver()` below
 * is the single function to swap.
 *
 * SAFETY POSTURE — read before loosening any of this. The thing calling this
 * module is an LLM reacting to a live, sometimes-misheard audio transcript.
 * "Send it to Dave" is one bad transcription away from mailing a stranger, and
 * unlike a bad shell command an email cannot be undone. So, mirroring the
 * seatbelts in shellTools.ts:
 *   - sending is OFF unless SMTP is explicitly configured (otherwise: dry run),
 *   - EMAIL_ALLOWLIST gates recipients by address or domain,
 *   - recipient count is capped (no accidental blasts),
 *   - the `sendApproval` guardrail turns a send into a draft (see emailTools.ts),
 *   - every attempt is logged.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { envOptional } from "./env.js";

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

export interface SendSpec {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface SendOutcome {
  ok: boolean;
  /** True when nothing left the machine (SMTP unconfigured or EMAIL_DRY_RUN=1). */
  dryRun: boolean;
  messageId?: string;
  accepted: string[];
  rejected: string[];
  error?: string;
}

export interface EmailStatus {
  configured: boolean;
  dryRun: boolean;
  from?: string;
  host?: string;
  port?: number;
  user?: string;
  allowlist: string[];
  maxRecipients: number;
}

/** Hard ceiling on recipients per message — a mis-parse shouldn't become a blast. */
const MAX_RECIPIENTS = Number(envOptional("EMAIL_MAX_RECIPIENTS") ?? 5);

// ── configuration ──────────────────────────────────────────────────────────
interface SmtpConf {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * Resolve SMTP settings. Two spellings are accepted: explicit SMTP_* vars, or
 * the GMAIL_USER / GMAIL_APP_PASSWORD shortcut (an app password from
 * myaccount.google.com/apppasswords — NOT your account password; it also
 * requires 2FA to be on).
 */
function smtpConf(): SmtpConf | undefined {
  const gmailUser = envOptional("GMAIL_USER");
  const gmailPass = envOptional("GMAIL_APP_PASSWORD");
  if (gmailUser && gmailPass) {
    return {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: gmailUser,
      pass: gmailPass.replace(/\s+/g, ""), // Google shows app passwords in 4-char groups
      from: envOptional("EMAIL_FROM") ?? gmailUser,
    };
  }

  const host = envOptional("SMTP_HOST");
  if (!host) return undefined;
  const port = Number(envOptional("SMTP_PORT") ?? 587);
  const user = envOptional("SMTP_USER");
  const from = envOptional("EMAIL_FROM") ?? user;
  if (!from) return undefined; // we must have something to put in From:
  return {
    host,
    port,
    // 465 is implicit TLS; 587 upgrades via STARTTLS.
    secure: (envOptional("SMTP_SECURE") ?? (port === 465 ? "1" : "0")) === "1",
    user,
    pass: envOptional("SMTP_PASS"),
    from,
  };
}

function dryRunMode(): boolean {
  if (envOptional("EMAIL_DRY_RUN") === "1") return true;
  return smtpConf() === undefined;
}

export function emailStatus(): EmailStatus {
  const c = smtpConf();
  return {
    configured: c !== undefined,
    dryRun: dryRunMode(),
    from: c?.from,
    host: c?.host,
    port: c?.port,
    user: c?.user,
    allowlist: allowlist(),
    maxRecipients: MAX_RECIPIENTS,
  };
}

// ── recipient validation ───────────────────────────────────────────────────
// Deliberately conservative: one @, no spaces, a dot in the domain. Rejecting a
// weird-but-legal address is a much better failure than mailing the wrong person.
const EMAIL_RE = /^[^\s@,;<>()[\]]+@[^\s@,;<>()[\]]+\.[a-z]{2,}$/i;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Comma-separated addresses and/or bare domains. Empty = allow anything. */
function allowlist(): string[] {
  return (envOptional("EMAIL_ALLOWLIST") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function allowed(addr: string): boolean {
  const list = allowlist();
  if (list.length === 0) return true;
  const a = addr.trim().toLowerCase();
  const domain = a.slice(a.indexOf("@") + 1);
  return list.some((entry) => (entry.includes("@") ? entry === a : entry === domain || domain.endsWith(`.${entry}`)));
}

export interface RecipientCheck {
  ok: string[];
  invalid: string[];
  blocked: string[];
}

/** Split a recipient list into usable / malformed / not-allowlisted. */
export function checkRecipients(list: string[]): RecipientCheck {
  const out: RecipientCheck = { ok: [], invalid: [], blocked: [] };
  const seen = new Set<string>();
  for (const raw of list) {
    const a = raw.trim();
    if (!a) continue;
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isValidEmail(a)) out.invalid.push(a);
    else if (!allowed(a)) out.blocked.push(a);
    else out.ok.push(a);
  }
  return out;
}

/** Parse the loose "a@b.com, c@d.com" / "a@b.com and c@d.com" an LLM produces. */
export function parseAddressList(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => parseAddressList(x));
  if (typeof v !== "string") return [];
  return v
    .split(/[,;]|\s+and\s+|\s+/i)
    .map((s) => s.trim().replace(/^<|>$/g, ""))
    .filter(Boolean);
}

// ── delivery ───────────────────────────────────────────────────────────────
let cached: { key: string; tx: Transporter } | undefined;

function transporter(c: SmtpConf): Transporter {
  // Reuse one pooled transport per distinct config — reconnecting per send is
  // slow enough to be audible when the plus1 is mid-sentence.
  const key = `${c.host}:${c.port}:${c.secure}:${c.user ?? ""}`;
  if (cached?.key === key) return cached.tx;
  const tx = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: c.user && c.pass ? { user: c.user, pass: c.pass } : undefined,
    pool: true,
    maxConnections: 2,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  cached = { key, tx };
  return tx;
}

/** Verify SMTP credentials without sending anything. */
export async function verifyEmail(): Promise<{ ok: boolean; error?: string }> {
  const c = smtpConf();
  if (!c) return { ok: false, error: "SMTP is not configured" };
  try {
    await transporter(c).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Send one message. Never throws — returns an outcome the agent can read out
 * loud, matching the convention in tools.ts that a tool failure is a sentence,
 * not a stack trace.
 */
export async function sendEmail(spec: SendSpec): Promise<SendOutcome> {
  const to = checkRecipients(spec.to);
  const cc = checkRecipients(spec.cc ?? []);
  const recipients = [...to.ok, ...cc.ok];

  if (recipients.length === 0) {
    const why = [
      to.invalid.length || cc.invalid.length ? `malformed: ${[...to.invalid, ...cc.invalid].join(", ")}` : "",
      to.blocked.length || cc.blocked.length ? `not on the allowlist: ${[...to.blocked, ...cc.blocked].join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    return { ok: false, dryRun: dryRunMode(), accepted: [], rejected: [], error: why || "no recipient given" };
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return {
      ok: false,
      dryRun: dryRunMode(),
      accepted: [],
      rejected: recipients,
      error: `too many recipients (${recipients.length} > ${MAX_RECIPIENTS})`,
    };
  }

  const subject = spec.subject.trim() || "(no subject)";
  const conf = smtpConf();

  if (dryRunMode() || !conf) {
    console.log(
      `[email] DRY RUN → ${recipients.join(", ")} | "${subject}" | ${spec.attachments?.length ?? 0} attachment(s)`,
    );
    return { ok: true, dryRun: true, accepted: recipients, rejected: [] };
  }

  try {
    const info = await transporter(conf).sendMail({
      from: conf.from,
      to: to.ok,
      cc: cc.ok.length ? cc.ok : undefined,
      replyTo: envOptional("EMAIL_REPLY_TO"),
      subject,
      text: spec.text,
      html: spec.html,
      attachments: spec.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType ?? "application/pdf",
      })),
    });
    const accepted = (info.accepted ?? []).map(String);
    const rejected = (info.rejected ?? []).map(String);
    console.log(`[email] sent ${info.messageId} → ${accepted.join(", ") || "(none)"}`);
    return {
      ok: accepted.length > 0,
      dryRun: false,
      messageId: info.messageId,
      accepted,
      rejected,
      error: accepted.length === 0 ? "the server accepted no recipients" : undefined,
    };
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(`[email] send failed: ${msg}`);
    return { ok: false, dryRun: false, accepted: [], rejected: recipients, error: friendlySmtpError(msg) };
  }
}

/** Turn the usual SMTP failures into something worth saying out loud. */
function friendlySmtpError(msg: string): string {
  if (/invalid login|username and password not accepted|535|534/i.test(msg)) {
    return "the mail server rejected the login — if it's Gmail, that needs an app password (2FA on, myaccount.google.com/apppasswords), not the account password";
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return "couldn't reach the mail server — check SMTP_HOST";
  if (/ETIMEDOUT|timeout/i.test(msg)) return "the mail server timed out";
  if (/self.signed|certificate/i.test(msg)) return "the mail server's TLS certificate wasn't accepted";
  return msg;
}
