import { PageBody, PageHeader } from "@/components/dash/PageHeader";
import { Button } from "@/components/ui";
import { Mail, PageMark, Calendar, DocSearch, Console, Chat, Check } from "@/components/icons";

type Tool = {
  name: string;
  what: string;
  Icon: typeof Mail;
  connected: boolean;
  account?: string;
  usedBy: string[];
};

const TOOLS: Tool[] = [
  {
    name: "Gmail",
    what: "Drafts follow-up email in your own account. Never sends without a spoken yes.",
    Icon: Mail,
    connected: true,
    account: "kevinxygu@gmail.com",
    usedBy: ["Reginald", "Margaret", "Wingman"],
  },
  {
    name: "Google Docs",
    what: "Reads a pasted doc, leaves comments, and reports what it found out loud.",
    Icon: DocSearch,
    connected: true,
    account: "kevinxygu@gmail.com",
    usedBy: ["Reginald", "Dr. Plume", "Wingman"],
  },
  {
    name: "Notion",
    what: "Writes meeting decisions and action items into the page you point it at.",
    Icon: PageMark,
    connected: true,
    account: "plus1 workspace",
    usedBy: ["Margaret", "Wingman"],
  },
  {
    name: "Google Calendar",
    what: "Books the follow-up while everyone is still in the room to agree to it.",
    Icon: Calendar,
    connected: true,
    account: "kevinxygu@gmail.com",
    usedBy: ["Reginald", "Margaret"],
  },
  {
    name: "Browserbase",
    what: "Opens a URL someone pasted in a cloud browser so the goose can actually read it.",
    Icon: Console,
    connected: true,
    account: "Session pool",
    usedBy: ["Dr. Plume"],
  },
  {
    name: "Slack",
    what: "Posts the artifact links to a channel after the meeting ends.",
    Icon: Chat,
    connected: false,
    usedBy: [],
  },
];

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Tools"
        description="What the goose can reach for during a meeting. Each persona sets its own policy per tool — call it automatically, ask first, or never."
      />

      <PageBody>
        <div className="overflow-hidden rounded-[var(--r)] border border-border">
          {TOOLS.map(({ name, what, Icon, connected, account, usedBy }) => (
            <div
              key={name}
              className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-sm)] border border-border bg-bg-subtle"
                style={{ color: connected ? "var(--fg-muted)" : "var(--fg-subtle)" }}
              >
                <Icon width={17} height={17} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13.5px] font-medium text-fg">{name}</p>
                  {connected ? (
                    <span className="chip" style={{ color: "var(--live)" }}>
                      <Check width={11} height={11} />
                      Connected
                    </span>
                  ) : (
                    <span className="chip" style={{ color: "var(--fg-subtle)" }}>
                      Not connected
                    </span>
                  )}
                </div>
                <p className="mt-1 max-w-[74ch] text-[13px] leading-snug text-fg-muted">{what}</p>
                {account && (
                  <p className="tnum mt-1 text-[12px] text-fg-subtle">{account}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3 sm:justify-end">
                {usedBy.length > 0 && (
                  <span className="hidden text-[12.5px] text-fg-subtle lg:inline">
                    {usedBy.join(", ")}
                  </span>
                )}
                <Button variant={connected ? "ghost" : "secondary"} size="sm">
                  {connected ? "Disconnect" : "Connect"}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 max-w-[76ch] text-[13px] leading-relaxed text-fg-muted">
          Sending, publishing and deleting are irreversible, so they always stop for an explicit
          spoken <span className="font-medium text-fg">yes</span> — even on a tool set to Auto.
          That rule is in the agent, not in this screen, and no persona can turn it off.
        </p>
      </PageBody>
    </>
  );
}
