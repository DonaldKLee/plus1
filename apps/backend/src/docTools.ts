/**
 * Documents as tools: turn whatever the plus1 has in hand — meeting notes, a
 * recap, action items, a summary — into a real PDF someone can download or get
 * emailed. Rendering lives in docPdf.ts; this wrapper coerces the loose
 * `details` the brain gathered into a DocSpec, the same way intactTools.ts does
 * for quote inputs.
 */
import { renderDocPdf } from "./docPdf.js";

type Details = Record<string, unknown>;

const strOf = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

export interface DocToolResult {
  text: string;
  /** Relative path the backend serves; the dashboard renders it as a download. */
  pdfUrl?: string;
  /** Publicly reachable link, when a tunnel / host is configured. */
  shareUrl?: string;
}

/** Cap the body so a runaway generation can't produce a 900-page PDF. */
const MAX_BODY = 60_000;

export async function runDocTool(
  name: string,
  args: { query?: string; content?: string; details?: Details; meetingId?: string },
): Promise<DocToolResult> {
  const d = args.details ?? {};

  if (name === "doc_pdf") {
    // The body can arrive in details.body, or in `content` (the generic text
    // channel the file tools use), or worst case as the query.
    const body = strOf(d.body) ?? strOf(args.content) ?? strOf(d.text) ?? strOf(args.query);
    if (!body) {
      return { text: "i need the actual text for the PDF — tell me what should be in it." };
    }
    const title = strOf(d.title) ?? strOf(d.subject) ?? "Notes";

    const doc = await renderDocPdf({
      title,
      subtitle: strOf(d.subtitle),
      body: body.slice(0, MAX_BODY),
      footer: strOf(d.footer),
      filename: strOf(d.filename) ?? title,
      meetingId: args.meetingId,
    });

    const pages = doc.pages === 1 ? "1 page" : `${doc.pages} pages`;
    const size = `${Math.round(doc.bytes / 1024)} KB`;
    // With a public URL configured the link is the useful artifact — it can go
    // straight into the meeting chat. Without one, only a local download exists.
    const text = doc.shareUrl
      ? `"${title}" is ready (${pages}, ${size}) — here's the link: ${doc.shareUrl}`
      : `"${title}" is ready as a PDF (${pages}, ${size}) — download it below. i can email it too if you give me an address.`;

    return { text, pdfUrl: doc.pdfUrl, shareUrl: doc.shareUrl };
  }

  return { text: `Unknown document tool: ${name}` };
}
