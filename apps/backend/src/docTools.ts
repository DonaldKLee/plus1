/**
 * Documents as tools: turn whatever the plus1 has in hand — meeting notes, a
 * recap, action items, a summary — into a real PDF someone can download or get
 * emailed. Rendering lives in docPdf.ts; this wrapper coerces the loose
 * `details` the brain gathered into a DocSpec, the same way intactTools.ts does
 * for quote inputs.
 */
import { renderDocPdf, type Figure } from "./docPdf.js";

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

/**
 * The key figures, coerced out of whatever shape the model produced. Gemini is
 * asked for `[{label, value, note}]`, but it also likes `{"Premium": "$142"}`
 * and `["Premium: $142"]`, and a dropped number is the one failure this whole
 * feature exists to prevent — so all three are accepted.
 */
function figuresOf(raw: unknown): Figure[] | undefined {
  const out: Figure[] = [];

  const push = (label?: string, value?: string, note?: string): void => {
    const l = label?.toString().trim();
    const v = value?.toString().trim();
    if (l && v) out.push({ label: l.slice(0, 40), value: v.slice(0, 24), note: note?.toString().trim().slice(0, 60) });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        const [label, ...rest] = item.split(":");
        push(label, rest.join(":"));
      } else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        push(
          (o.label ?? o.name ?? o.key) as string,
          (o.value ?? o.amount ?? o.figure) as string,
          (o.note ?? o.detail ?? o.sub) as string,
        );
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v !== null && typeof v !== "object") push(k, String(v));
    }
  }

  return out.length ? out.slice(0, 6) : undefined;
}

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
      figures: figuresOf(d.figures),
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
