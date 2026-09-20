"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Plus1Mark, Button, Chip, cx } from "@/components/ui";
// `Link as LinkIcon`: next/link is already imported as Link in this file.
import { History, Plug, PageMark, External, Check, Link as LinkIcon } from "@/components/icons";
import { AGENT_URL } from "@/lib/session";
import { createChat, sendChatMessage, type ChatMessage } from "@/lib/chat";
import { QuoteCard } from "./QuoteCard";

function readConfig(): { name?: string; servers?: Record<string, boolean>; localAccess?: string } {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem("plus1.plus1.config") || "{}");
  } catch {
    return {};
  }
}

function plus1Name(): string {
  return readConfig().name?.trim() || "plus1";
}

type Tools = { federato: boolean; intact: boolean; docs: boolean; email: boolean; files: "off" | "read" | "write" };
function readTools(): Tools {
  const c = readConfig();
  return {
    federato: c.servers?.federato !== false,
    intact: c.servers?.intact !== false,
    docs: c.servers?.docs === true,
    email: c.servers?.email === true,
    files: !c.servers?.local ? "off" : c.localAccess === "write" ? "write" : "read",
  };
}

let localId = 0;
const mkLocal = (role: ChatMessage["role"], text: string, kind: ChatMessage["kind"] = "text"): ChatMessage => ({
  id: `local-${localId++}`,
  role,
  kind,
  text,
  at: new Date().toISOString(),
});

const INTRO_SPEED_MS = 18; // ms per character

export function Chat() {
  const [name] = useState(plus1Name);
  const [tools, setTools] = useState<Tools>({ federato: true, intact: true, docs: false, email: false, files: "off" });
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [introText, setIntroText] = useState("");
  const [introFull, setIntroFull] = useState(false);
  const [introId] = useState(() => `local-intro-${Date.now()}`);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const runTyping = useCallback((fullText: string) => {
    let i = 0;
    setIntroText("");
    setIntroFull(false);
    const tick = () => {
      i++;
      setIntroText(fullText.slice(0, i));
      if (i < fullText.length) {
        setTimeout(tick, INTRO_SPEED_MS);
      } else {
        setIntroFull(true);
      }
    };
    setTimeout(tick, 120);
  }, []);

  useEffect(() => {
    let alive = true;
    createChat()
      .then((id) => {
        if (!alive) return;
        setChatId(id);
        const full = `hey, i'm ${name.toLowerCase()}. ask me anything, or tell me to do something — i've got the same tools i use in meetings. if it gets involved, i'll offer to hop on a call.`;
        runTyping(full);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [name, runTyping]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // Keep the tool badges in sync with the plus1 tab (which may be edited elsewhere).
  useEffect(() => {
    const sync = () => setTools(readTools());
    sync();
    window.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || !chatId || sending) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, mkLocal("user", text)]);
    setSending(true);
    try {
      const reply = await sendChatMessage(chatId, text);
      setMessages((m) => [...m, ...reply]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header — matches PageHeader style */}
      <header className="page-enter shrink-0 border-b border-border bg-bg px-5 py-6 sm:px-7 lg:px-9">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Plus1Mark size={26} className="shrink-0 text-fg" />
            <div>
              <h1 className="text-[26px] font-semibold tracking-[-0.04em] text-fg">{name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {tools.federato && <Chip color="var(--act)">federato</Chip>}
                {tools.intact && <Chip color="var(--alert)">intact</Chip>}
                {tools.docs && <Chip color="var(--think)">pdf</Chip>}
                {tools.email && <Chip color="var(--live)">email</Chip>}
                <Link href="/app/plus1" title="configure in the plus1 tab">
                  <Chip
                    color={
                      tools.files === "write"
                        ? "var(--live)"
                        : tools.files === "read"
                          ? "var(--think)"
                          : undefined
                    }
                  >
                    {tools.files === "off"
                      ? "files off"
                      : tools.files === "write"
                        ? "files · read & write"
                        : "files · read only"}
                  </Chip>
                </Link>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/app/meetings">
              <Button variant="secondary" size="sm">
                <History width={15} height={15} />
                Start a meeting
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
          {/* typing intro bubble */}
          {(introText || !introFull) && chatId && (
            <div key={introId} className="flex gap-2.5">
              <Plus1Mark size={22} className="mt-0.5 shrink-0 text-fg" />
              <div className="max-w-[80%] rounded-[var(--r-lg)] rounded-tl-[4px] border border-border bg-bg-subtle px-3.5 py-2 text-[14px] leading-relaxed text-fg">
                {introText}
                {!introFull && <span className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-fg-subtle align-middle" />}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-[var(--r-lg)] rounded-br-[4px] bg-inverse-bg px-3.5 py-2 text-[14px] leading-relaxed text-inverse-fg">
                  {m.text}
                </div>
              </div>
            ) : m.kind === "quote" && m.quote ? (
              <div key={m.id} className="flex gap-2.5">
                <Plus1Mark size={22} className="mt-0.5 shrink-0 text-fg" />
                <div className="min-w-0 max-w-[92%] flex-1">
                  <QuoteCard q={m.quote} />
                  <Extras m={m} />
                </div>
              </div>
            ) : m.kind === "tool" ? (
              <div key={m.id} className="flex gap-2.5">
                <Spacer />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Plug width={12} height={12} className="text-fg-subtle" />
                    <span className="text-[12px] font-medium text-fg-subtle">ran {m.tool}</span>
                  </div>
                  <pre className="tnum overflow-x-auto whitespace-pre-wrap rounded-[var(--r)] border border-border bg-bg-inset px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">
                    {m.text}
                  </pre>
                  <Extras m={m} />
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <Plus1Mark size={22} className="mt-0.5 shrink-0 text-fg" />
                <div className="max-w-[80%] rounded-[var(--r-lg)] rounded-tl-[4px] border border-border bg-bg-subtle px-3.5 py-2 text-[14px] leading-relaxed text-fg">
                  {m.text}
                </div>
              </div>
            ),
          )}

          {sending && (
            <div className="flex gap-2.5">
              <Plus1Mark size={22} className="mt-0.5 shrink-0 text-fg" />
              <div className="flex items-center gap-1 rounded-[var(--r-lg)] rounded-tl-[4px] border border-border bg-bg-subtle px-3.5 py-3">
                <Dotty /> <Dotty d={0.15} /> <Dotty d={0.3} />
              </div>
            </div>
          )}

          {error && (
            <p className="text-center text-[12.5px] text-[color:var(--alert)]">{error}</p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-border px-4 py-3 sm:px-7">
        <div className="mx-auto flex w-full max-w-[760px] items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={chatId ? `message ${name.toLowerCase()}…` : "connecting…"}
            disabled={!chatId}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            className={cx(
              "max-h-40 min-h-[42px] w-full resize-none rounded-[var(--r)] border border-border bg-bg px-3.5 py-2.5",
              "text-[14px] leading-relaxed text-fg transition-colors",
              "hover:border-border-strong focus:border-border-strong focus:outline-none",
              "focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[var(--ring)]",
            )}
          />
          <Button variant="primary" size="lg" onClick={() => void send()} disabled={!input.trim() || sending || !chatId}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function Spacer() {
  return <span className="w-[22px] shrink-0" aria-hidden />;
}

/** Copy the public share link — the thing you'd paste into a chat yourself. */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      title={url}
      aria-label={copied ? "Share link copied" : `Copy share link: ${url}`}
      className="inline-flex items-center gap-1.5 rounded-[var(--r-sm)] border border-border bg-bg px-3 py-1.5 text-[12.5px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-bg-raise"
    >
      {copied ? <Check width={14} height={14} /> : <LinkIcon width={14} height={14} />}
      {copied ? "Link copied" : "Copy share link"}
    </button>
  );
}

/** PDF download + share link + broker-call actions attached to a message. */
function Extras({ m }: { m: ChatMessage }) {
  if (!m.pdfUrl && !m.nextStep && !m.shareUrl) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {m.pdfUrl && (
        <a
          href={`${AGENT_URL}${m.pdfUrl}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-[var(--r-sm)] border border-border bg-bg px-3 py-1.5 text-[12.5px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-bg-raise"
        >
          <PageMark width={14} height={14} />
          {m.kind === "quote" ? "Download quote PDF" : "Open PDF"}
          <External width={12} height={12} className="text-fg-subtle" />
        </a>
      )}
      {m.shareUrl && <CopyLink url={m.shareUrl} />}
      {m.nextStep && (
        <Link
          href="/app/meetings"
          className="inline-flex items-center gap-1.5 rounded-[var(--r-sm)] bg-inverse-bg px-3 py-1.5 text-[12.5px] font-medium text-inverse-fg transition-opacity hover:opacity-85"
        >
          <History width={14} height={14} /> Book a broker call
        </Link>
      )}
    </div>
  );
}

function Dotty({ d = 0 }: { d?: number }) {
  return (
    <span
      className="h-1.5 w-1.5 rounded-full bg-fg-subtle"
      style={{ animation: `dotpulse 1.1s ease-in-out ${d}s infinite` }}
    />
  );
}
