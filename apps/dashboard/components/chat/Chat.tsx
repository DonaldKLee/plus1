"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GooseMark, Button, Chip, cx } from "@/components/ui";
import { History, Plug } from "@/components/icons";
import { createChat, sendChatMessage, type ChatMessage } from "@/lib/chat";
import { QuoteCard } from "./QuoteCard";

function readConfig(): { name?: string; servers?: Record<string, boolean>; localAccess?: string } {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem("plus1.goose.config") || "{}");
  } catch {
    return {};
  }
}

function gooseName(): string {
  return readConfig().name?.trim() || "Goose";
}

type Tools = { federato: boolean; files: "off" | "read" | "write" };
function readTools(): Tools {
  const c = readConfig();
  return {
    federato: c.servers?.federato !== false,
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

export function Chat() {
  const [name] = useState(gooseName);
  const [tools, setTools] = useState<Tools>({ federato: true, files: "off" });
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    createChat()
      .then((id) => {
        if (!alive) return;
        setChatId(id);
        setMessages([
          mkLocal("bob", `hey, i'm ${name.toLowerCase()}. ask me anything, or tell me to do something — i've got the same tools i use in meetings. if it gets involved, i'll offer to hop on a call.`),
        ]);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [name]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  // Keep the tool badges in sync with the Goose tab (which may be edited elsewhere).
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
      {/* header */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-7">
        <div className="flex items-center gap-2.5">
          <GooseMark size={22} className="text-fg" />
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-fg">{name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {tools.federato && <Chip color="var(--act)">federato</Chip>}
              <Link href="/app/goose" title="configure in the Goose tab">
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
        <Link href="/app/meetings">
          <Button variant="secondary" size="sm">
            <History width={15} height={15} />
            Start a meeting
          </Button>
        </Link>
      </header>

      {/* messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-[var(--r-lg)] rounded-br-[4px] bg-inverse-bg px-3.5 py-2 text-[14px] leading-relaxed text-inverse-fg">
                  {m.text}
                </div>
              </div>
            ) : m.kind === "quote" && m.quote ? (
              <div key={m.id} className="flex gap-2.5">
                <GooseMark size={22} className="mt-0.5 shrink-0 text-fg" />
                <div className="min-w-0 max-w-[92%] flex-1">
                  <QuoteCard q={m.quote} />
                </div>
              </div>
            ) : m.kind === "tool" ? (
              <div key={m.id} className="flex gap-2.5">
                <Spacer />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5">
                    <Plug width={12} height={12} className="text-fg-subtle" />
                    <span className="eyebrow">ran {m.tool}</span>
                  </div>
                  <pre className="tnum overflow-x-auto whitespace-pre-wrap rounded-[var(--r)] border border-border bg-bg-inset px-3 py-2.5 text-[12.5px] leading-relaxed text-fg-muted">
                    {m.text}
                  </pre>
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5">
                <GooseMark size={22} className="mt-0.5 shrink-0 text-fg" />
                <div className="max-w-[80%] rounded-[var(--r-lg)] rounded-tl-[4px] border border-border bg-bg-subtle px-3.5 py-2 text-[14px] leading-relaxed text-fg">
                  {m.text}
                </div>
              </div>
            ),
          )}

          {sending && (
            <div className="flex gap-2.5">
              <GooseMark size={22} className="mt-0.5 shrink-0 text-fg" />
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

function Dotty({ d = 0 }: { d?: number }) {
  return (
    <span
      className="h-1.5 w-1.5 rounded-full bg-fg-subtle"
      style={{ animation: `dotpulse 1.1s ease-in-out ${d}s infinite` }}
    />
  );
}
