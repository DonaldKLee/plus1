"use client";

import { useState } from "react";
import type { Policy } from "@/lib/types";
import { Chat, Mail, Calendar, PageMark, DocSearch, Plug } from "./icons";

interface Tool {
  name: string;
  policy: Policy;
  irreversible?: boolean;
}
interface Server {
  id: string;
  name: string;
  Icon: typeof Mail;
  color: string;
  url: string;
  status: "connected" | "disconnected";
  tools: Tool[];
}

const SERVERS: Server[] = [
  {
    id: "slack",
    name: "Slack",
    Icon: Chat,
    color: "var(--color-live)",
    url: "mcp://slack.plus1.dev",
    status: "connected",
    tools: [
      { name: "search_messages", policy: "Auto" },
      { name: "send_message", policy: "Ask", irreversible: true },
      { name: "list_channels", policy: "Auto" },
      { name: "add_reaction", policy: "Auto" },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    Icon: Mail,
    color: "var(--color-act)",
    url: "mcp://gmail.plus1.dev",
    status: "connected",
    tools: [
      { name: "search", policy: "Auto" },
      { name: "get_thread", policy: "Auto" },
      { name: "create_draft", policy: "Auto" },
      { name: "send_email", policy: "Ask", irreversible: true },
    ],
  },
  {
    id: "gcal",
    name: "Calendar",
    Icon: Calendar,
    color: "var(--color-live)",
    url: "mcp://gcal.plus1.dev",
    status: "connected",
    tools: [
      { name: "list_events", policy: "Auto" },
      { name: "find_free_time", policy: "Auto" },
      { name: "create_event", policy: "Auto" },
      { name: "delete_event", policy: "Off", irreversible: true },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    Icon: PageMark,
    color: "var(--color-gate)",
    url: "mcp://notion.plus1.dev",
    status: "connected",
    tools: [
      { name: "search", policy: "Auto" },
      { name: "query_database", policy: "Auto" },
      { name: "update_page", policy: "Ask", irreversible: true },
      { name: "create_page", policy: "Ask" },
    ],
  },
  {
    id: "browserbase",
    name: "Browserbase",
    Icon: DocSearch,
    color: "var(--color-act)",
    url: "mcp://browserbase.plus1.dev",
    status: "connected",
    tools: [{ name: "review_document", policy: "Auto" }],
  },
];

const POLICIES: Policy[] = ["Auto", "Ask", "Off"];
const POLICY_COLOR: Record<Policy, string> = {
  Auto: "var(--color-live)",
  Ask: "var(--color-gate)",
  Off: "var(--color-ink-3)",
};

function Segmented({ value, onChange }: { value: Policy; onChange: (p: Policy) => void }) {
  return (
    <div className="flex rounded-[3px] border border-line p-[2px]">
      {POLICIES.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            className="rounded-[2px] px-2.5 py-1 text-[10px] font-600 transition-colors"
            style={{
              color: active ? "var(--color-bg)" : "var(--color-ink-3)",
              background: active ? POLICY_COLOR[p] : "transparent",
            }}
          >
            {p}
          </button>
        );
      })}
    </div>
  );
}

function ServerCard({ server }: { server: Server }) {
  const [tools, setTools] = useState(server.tools);
  const { Icon } = server;

  return (
    <div className="panel reticle overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-[3px]"
          style={{
            color: server.color,
            background: `color-mix(in srgb, ${server.color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${server.color} 28%, transparent)`,
          }}
        >
          <Icon width={18} height={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-600 text-ink">{server.name}</span>
            <span
              className="chip !py-0 !px-1.5 text-[9px]"
              style={{ color: server.status === "connected" ? "var(--color-live)" : "var(--color-ink-3)" }}
            >
              <span className="led" style={{ color: server.status === "connected" ? "var(--color-live)" : "var(--color-ink-3)" }} />
              {server.status}
            </span>
          </div>
          <p className="data truncate text-[10px] text-ink-3">{server.url}</p>
        </div>
        <span className="data text-[10px] text-ink-3">{tools.length} tools</span>
      </div>

      <div className="divide-y divide-line">
        {tools.map((t) => (
          <div key={t.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="data text-[12px] text-ink">{t.name}</span>
              {t.irreversible && (
                <span className="chip !py-0 !px-1.5 text-[8.5px]" style={{ color: "var(--color-alert)" }}>
                  irreversible
                </span>
              )}
            </div>
            <Segmented
              value={t.policy}
              onChange={(p) => setTools((ts) => ts.map((x) => (x.name === t.name ? { ...x, policy: p } : x)))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Integrations() {
  return (
    <section className="panel reticle min-h-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-6 py-3 backdrop-blur">
        <div>
          <h1 className="font-display text-[17px] font-700 tracking-tight text-ink">Tools</h1>
          <p className="data text-[10px] text-ink-3">MCP servers · per-tool policy · JSON-RPC 2.0</p>
        </div>
        <div className="flex items-center gap-3 data text-[10px] text-ink-3">
          <span className="flex items-center gap-1.5"><span className="led" style={{ color: "var(--color-live)" }} />Auto</span>
          <span className="flex items-center gap-1.5"><span className="led" style={{ color: "var(--color-gate)" }} />Ask</span>
          <span className="flex items-center gap-1.5"><span className="led" style={{ color: "var(--color-ink-3)" }} />Off</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-3 px-6 py-6">
        {SERVERS.map((s) => (
          <ServerCard key={s.id} server={s} />
        ))}

        <button className="flex w-full items-center justify-center gap-2 rounded-[3px] border border-dashed border-line-2 px-4 py-4 text-[12px] font-600 text-ink-2 transition-colors hover:border-act hover:text-act">
          <Plug width={16} height={16} />
          Add custom MCP URL
        </button>
      </div>
    </section>
  );
}
