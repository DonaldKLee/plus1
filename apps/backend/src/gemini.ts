/**
 * One structured-JSON Gemini call, shared by the brain (decide / narrate) and the Federato
 * query planner. Retries 5xx and per-minute 429s; a per-DAY quota 429 surfaces as a distinct
 * `quota` error the caller can report once instead of retrying forever.
 */
import { env } from "./env.js";

// gemini-flash-latest currently maps to gemini-3.8-flash (only 20 free req/day).
// flash-lite-latest has far more free headroom and is plenty for classification.
export const DECIDE_MODEL = process.env.GEMINI_BRAIN_MODEL || "gemini-flash-lite-latest";

export type InlineImage = { mimeType: string; data: string };

export async function generateJson(
  systemText: string,
  userText: string,
  schema: Record<string, unknown>,
  temperature = 0.2,
  model = DECIDE_MODEL,
  images?: InlineImage[],
): Promise<Record<string, unknown>> {
  const key = env("GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const parts: Array<{ text: string } | { inlineData: InlineImage }> = [{ text: userText }];
  for (const img of images ?? []) parts.push({ inlineData: img });
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, responseMimeType: "application/json", responseSchema: schema },
  };

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
      const err = new Error("Gemini brain quota exhausted for today (free tier).") as Error & { quota?: boolean };
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

  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
