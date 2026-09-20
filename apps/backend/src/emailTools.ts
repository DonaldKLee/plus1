/**
 * Email as tools — the "email MCP" in this repo's sense of the word: an
 * in-process tool module routed by name prefix from tools.ts, exactly like
 * intactTools.ts and federatoTools.ts. (There is no MCP-protocol server here;
 * see INTACT_MCP_LLD.md, which uses the same naming.)
 *
 * Transport and all the safety rails live in email.ts. This layer is about
 * turning a loose LLM `details` bag into a well-formed message, and about the
 * TWO-STEP CONFIRMATION that keeps a misheard sentence from mailing a stranger:
 *
 *   sendApproval guardrail ON (the default in the plus1 tab)
 *     → the first email_send call NEVER sends. It returns a preview and asks.
 *     → the plus1 reads the preview out loud; a human says yes; the brain calls
 *       again with details.confirm = true, and that one sends.
 *   sendApproval OFF
 *     → sends immediately.
 *
 * An email can't be unsent, so the default is the cautious path.
 */
import {
  sendEmail,
  emailStatus,
  verifyEmail,
  checkRecipients,
  parseAddressList,
  defaultRecipient,
  type EmailAttachment,
} from "./email.js";
import { loadDoc, lastDocId, shareUrlFor } from "./docPdf.js";
import { getQuotePdf } from "./intactPdf.js";

type Details = Record<string, unknown>;

const strOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const boolOf = (v: unknown): boolean | undefined => {
  if (typeof v === "boolean") return v;
  // The model sometimes returns "true"/"yes" as a string.
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  return undefined;
};

export interface EmailToolResult {
  text: string;
  /** Set when a draft carries an attachment, so the card still offers the download. */
  pdfUrl?: string;
  /** Public link to the attached document, when one is configured. */
  shareUrl?: string;
  /** True when this turn only previewed — the caller may want to surface that. */
  pendingApproval?: boolean;
}

export interface EmailToolOpts {
  /** From guardrails.sendApproval — when true, require an explicit confirm. */
  requireApproval?: boolean;
}

/**
 * Resolve details.attachPdf into real bytes.
 *
 * Accepts a document id, a quote id, or "last"/"latest"/"it"/"the pdf" meaning
 * the most recently rendered document — because in speech nobody says a uuid.
 */
async function resolveAttachment(
  d: Details,
): Promise<{ attachment?: EmailAttachment; pdfUrl?: string; shareUrl?: string; note?: string }> {
  const raw = strOf(d.attachPdf) ?? strOf(d.attachment) ?? strOf(d.pdfId);
  const wantsAttachment = boolOf(d.attach) === true;
  if (!raw && !wantsAttachment) return {};

  const ref = (raw ?? "last").toLowerCase();
  const wantsLast = ["last", "latest", "it", "that", "the pdf", "pdf", "true", "yes"].includes(ref);
  const id = wantsLast ? lastDocId() : (raw as string);

  if (!id) {
    return { note: "i don't have a PDF made yet, so i'm sending it without an attachment — say the word and i'll generate one first." };
  }

  // loadDoc falls back to Mongo, so this still works after a backend restart.
  const doc = await loadDoc(id);
  if (doc) {
    return {
      attachment: { filename: doc.filename, content: doc.bytes, contentType: "application/pdf" },
      pdfUrl: `/api/doc/${id}.pdf`,
      shareUrl: shareUrlFor(doc.token),
    };
  }

  // Not a document — it may be an Intact quote PDF from the other store.
  const quote = getQuotePdf(id as string);
  if (quote) {
    return {
      attachment: { filename: `intact-quote-${id.slice(0, 8)}.pdf`, content: quote, contentType: "application/pdf" },
      pdfUrl: `/api/intact/quote/${id}.pdf`,
    };
  }

  return { note: "the PDF i had has expired, so i'm sending this without the attachment." };
}

/** Render the preview the room hears before anything is sent. */
function previewOf(opts: {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachment?: EmailAttachment;
}): string {
  const lines = [
    `to: ${opts.to.join(", ")}`,
    opts.cc.length ? `cc: ${opts.cc.join(", ")}` : "",
    `subject: ${opts.subject}`,
    opts.attachment ? `attached: ${opts.attachment.filename}` : "",
    "",
    opts.body.length > 700 ? `${opts.body.slice(0, 700)}…` : opts.body,
  ].filter(Boolean);
  return lines.join("\n");
}

export async function runEmailTool(
  name: string,
  args: { query?: string; content?: string; details?: Details },
  opts: EmailToolOpts = {},
): Promise<EmailToolResult> {
  const d = args.details ?? {};

  // ── email_status ─────────────────────────────────────────────────────────
  if (name === "email_status") {
    const s = emailStatus();
    if (!s.configured) {
      return {
        text:
          "email isn't connected yet — it needs SMTP_HOST/SMTP_USER/SMTP_PASS (or GMAIL_USER + GMAIL_APP_PASSWORD) in .env. " +
          "until then i'll draft messages and make the PDF, but nothing actually goes out.",
      };
    }
    const check = await verifyEmail();
    const gate = s.allowlist.length ? ` only allowed to mail: ${s.allowlist.join(", ")}.` : "";
    const def = s.defaultTo ? ` default recipient ${s.defaultTo}.` : "";
    return {
      text: check.ok
        ? `email's live — sending as ${s.from} via ${s.host}.${gate}${def}`
        : `email is configured as ${s.from} via ${s.host}, but the login failed: ${check.error}`,
    };
  }

  // ── email_send ───────────────────────────────────────────────────────────
  if (name === "email_send" || name === "email_draft") {
    const named = parseAddressList(d.to ?? d.email ?? d.recipient ?? args.query);
    const fallback = defaultRecipient();
    const to = named.length ? named : fallback ? [fallback] : [];
    const cc = parseAddressList(d.cc);
    const subject = strOf(d.subject) ?? strOf(d.title) ?? "";
    const body = strOf(d.body) ?? strOf(args.content) ?? strOf(d.text) ?? strOf(d.message) ?? "";

    if (to.length === 0) {
      return { text: "who should i send it to? i need an email address." };
    }
    if (!body && !subject) {
      return { text: "what do you want the email to say?" };
    }

    // Validate before previewing, so we don't read out a draft we can't send.
    const check = checkRecipients(to);
    if (check.ok.length === 0) {
      if (check.invalid.length) {
        return { text: `"${check.invalid.join(", ")}" doesn't look like a valid email address — can you spell it out for me?` };
      }
      return { text: `i'm not allowed to email ${check.blocked.join(", ")} — that address isn't on the approved list.` };
    }

    const { attachment, pdfUrl, shareUrl, note } = await resolveAttachment(d);
    const finalSubject = subject || "Notes from the meeting";
    let finalBody = body || "(see the attached PDF)";
    // When there's a public link, include it as well as the attachment — some
    // mail clients bury attachments, and a link works on a phone.
    if (shareUrl && !finalBody.includes(shareUrl)) {
      finalBody = `${finalBody}\n\nYou can also view it here: ${shareUrl}`;
    }
    const preview = previewOf({ to: check.ok, cc: checkRecipients(cc).ok, subject: finalSubject, body: finalBody, attachment });

    // Step one: preview and ask. `email_draft` always stops here; `email_send`
    // stops here too while the sendApproval guardrail is on and unconfirmed.
    const confirmed = boolOf(d.confirm) === true;
    if (name === "email_draft" || (opts.requireApproval && !confirmed)) {
      const ask =
        name === "email_draft"
          ? "here's the draft — want me to send it?"
          : "before i send it, here's exactly what goes out — say the word and it's gone:";
      return {
        text: `${ask}\n\n${preview}${note ? `\n\n(${note})` : ""}`,
        pdfUrl,
        shareUrl,
        pendingApproval: true,
      };
    }

    // Step two: actually deliver.
    const out = await sendEmail({
      to: check.ok,
      cc,
      subject: finalSubject,
      text: finalBody,
      attachments: attachment ? [attachment] : undefined,
    });

    if (!out.ok) {
      // A failed send shouldn't lose the artifact — offer the link instead.
      const fallback = shareUrl ? ` you can still grab it here: ${shareUrl}` : "";
      return {
        text: `i couldn't send it — ${out.error ?? "the mail server refused it"}.${fallback}`,
        pdfUrl,
        shareUrl,
      };
    }
    if (out.dryRun) {
      return {
        text: shareUrl
          ? `email isn't connected yet, so that didn't actually go out — but here's the link instead: ${shareUrl}`
          : `email isn't connected yet, so that didn't actually go out — but the draft and the PDF are ready. ` +
            `add GMAIL_USER + GMAIL_APP_PASSWORD (or the SMTP_* vars) to .env and it'll send for real.`,
        pdfUrl,
        shareUrl,
      };
    }
    const withAttachment = attachment ? ` with ${attachment.filename} attached` : "";
    return {
      text: `sent${withAttachment} to ${out.accepted.join(", ")}.${note ? ` (${note})` : ""}`,
      pdfUrl,
      shareUrl,
    };
  }

  return { text: `Unknown email tool: ${name}` };
}
