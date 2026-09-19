import { PAGE_EVENT_SINK, type PageEvent } from "../page-protocol.js";

type Sink = (e: PageEvent) => unknown;

/** Report to Node (Playwright exposeFunction) if present; always mirror to the console at debug level. */
export function report(event: PageEvent): void {
  try {
    const sink = (window as unknown as Record<string, Sink | undefined>)[PAGE_EVENT_SINK];
    if (typeof sink === "function") void Promise.resolve(sink(event)).catch(() => {});
  } catch { /* never let telemetry break media */ }
  if (event.kind !== "audioLevel") console.debug("[plus1-avatar]", event);
}

export const log = {
  debug: (message: string) => report({ kind: "log", level: "debug", message }),
  info: (message: string) => report({ kind: "log", level: "info", message }),
  warn: (message: string) => report({ kind: "log", level: "warn", message }),
};
