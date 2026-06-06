"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Plus, MessageSquare, Loader2, Square, Brain, Download, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Session, Message, Provider } from "@/lib/types";
import { ProviderSwitcher } from "@/components/provider-switcher";
import { Markdown } from "@/components/markdown";
import { chatToMarkdown, downloadText, slugify } from "@/lib/export";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamingMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MessageBubble({ msg }: { msg: StreamingMessage }) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className={cn("group flex flex-col w-full", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[72%] px-4 py-2 rounded-2xl text-sm leading-relaxed break-words",
          isUser ? "rounded-br-sm whitespace-pre-wrap" : "rounded-bl-sm"
        )}
        style={
          isUser
            ? { background: "var(--primary)", color: "var(--primary-foreground)" }
            : { background: "var(--muted)", color: "var(--foreground)" }
        }
      >
        {isUser ? msg.content : <Markdown>{msg.content}</Markdown>}
        {msg.streaming && (
          <span
            className="inline-block w-1.5 h-4 ml-1 align-middle animate-pulse"
            style={{ background: "currentColor", opacity: 0.6 }}
            aria-hidden="true"
          />
        )}
      </div>
      {!msg.streaming && msg.content.trim() && (
        <button
          onClick={copy}
          className="flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--muted-foreground)" }}
          title="Copy message"
        >
          {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

function SessionItem({
  session,
  active,
  onClick,
}: {
  session: Session;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-md text-xs truncate transition-colors",
        active ? "font-semibold" : "hover:opacity-80"
      )}
      style={{
        background: active ? "var(--sidebar-item-active)" : "transparent",
        color: active
          ? "var(--sidebar-item-active-text)"
          : "var(--sidebar-text)",
      }}
      title={session.title}
    >
      {session.title}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ChatShell — main layout
// ---------------------------------------------------------------------------

export function ChatShell() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StreamingMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [useContext, setUseContext] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load sessions on mount
  useEffect(() => {
    api
      .listSessions()
      .then(setSessions)
      .catch(() => {
        /* backend may not be running yet — silent fail */
      });
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setLoadingSession(true);
    setError(null);
    try {
      const detail = await api.getSession(id);
      setActiveSessionId(id);
      setMessages(
        detail.messages.map((m: Message) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const handleNewSession = useCallback(async () => {
    setError(null);
    try {
      const session = await api.createSession();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    }
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setError(null);

    let sessionId = activeSessionId;

    // Auto-create session if none is active
    if (!sessionId) {
      try {
        const session = await api.createSession(text.slice(0, 50));
        setSessions((prev) => [session, ...prev]);
        sessionId = session.id;
        setActiveSessionId(session.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create session");
        return;
      }
    }

    // Optimistic user message
    const userMsg: StreamingMessage = {
      id: `tmp-user-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantMsgId = `tmp-assistant-${Date.now()}`;
    const assistantMsg: StreamingMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await api.streamChat(
        sessionId,
        text,
        (delta) => {
          if (delta === null) {
            // Stream ended — mark done and refresh sessions list
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, streaming: false } : m
              )
            );
            api.listSessions().then(setSessions).catch(() => {});
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + delta }
                  : m
              )
            );
          }
        },
        abort.signal,
        activeProvider?.id,
        activeProvider?.model,
        useContext,
      );
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError(e instanceof Error ? e.message : "Streaming failed");
        // Remove the blank assistant message on error
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      // Clear any lingering streaming cursor (e.g. after a manual stop).
      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
      );
    }
  }, [input, isStreaming, activeSessionId, useContext]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  function exportChat() {
    const title =
      (activeSessionId ? sessions.find((s) => s.id === activeSessionId)?.title : null) ?? "Chat";
    downloadText(`${slugify(title)}.md`, chatToMarkdown(title, messages));
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full" style={{ background: "var(--background)" }}>
      {/* Session sidebar */}
      <aside
        className="flex flex-col shrink-0 border-r py-3 gap-1"
        style={{
          width: 180,
          borderColor: "var(--border)",
          background: "var(--sidebar-bg)",
        }}
      >
        <div className="px-2 pb-1">
          <button
            onClick={handleNewSession}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-xs font-medium transition-colors hover:opacity-80"
            style={{
              background: "var(--primary)",
              color: "var(--primary-foreground)",
            }}
          >
            <Plus size={13} aria-hidden="true" />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 flex flex-col gap-0.5">
          {sessions.length === 0 ? (
            <p
              className="px-3 py-2 text-xs"
              style={{ color: "var(--muted-foreground)" }}
            >
              No chats yet
            </p>
          ) : (
            sessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                active={s.id === activeSessionId}
                onClick={() => {
                  if (s.id !== activeSessionId) loadSession(s.id);
                }}
              />
            ))
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header
          className="flex items-center gap-2 px-5 py-3 border-b shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <MessageSquare
            size={16}
            style={{ color: "var(--muted-foreground)" }}
            aria-hidden="true"
          />
          <span className="text-sm font-medium flex-1 truncate">
            {activeSessionId
              ? (sessions.find((s) => s.id === activeSessionId)?.title ??
                "Chat")
              : "Chat"}
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={exportChat}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-opacity hover:opacity-80 shrink-0"
              style={{ color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
              title="Export this conversation as Markdown"
            >
              <Download size={13} aria-hidden="true" />
              Export
            </button>
          )}
          <button
            type="button"
            onClick={() => setUseContext((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors shrink-0"
            style={{
              background: useContext ? "var(--muted)" : "transparent",
              color: useContext ? "var(--foreground)" : "var(--muted-foreground)",
              border: "1px solid var(--border)",
            }}
            title={
              useContext
                ? "Knowledge context ON — pinned memories + retrieved notes/docs are injected"
                : "Knowledge context OFF — plain chat, no retrieval"
            }
            aria-pressed={useContext}
          >
            <Brain size={13} aria-hidden="true" />
            {useContext ? "Context" : "No context"}
          </button>
          <ProviderSwitcher onProviderChange={setActiveProvider} />
        </header>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loadingSession ? (
            <div className="flex justify-center pt-12">
              <Loader2
                size={24}
                className="animate-spin"
                style={{ color: "var(--muted-foreground)" }}
              />
            </div>
          ) : messages.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center h-full gap-3 text-center"
              style={{ color: "var(--muted-foreground)" }}
            >
              <MessageSquare size={40} aria-hidden="true" />
              <p className="text-sm font-medium">Start a conversation</p>
              <p className="text-xs max-w-xs">
                Type a message below. A new session is created automatically.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl mx-auto">
              {messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div
            className="mx-5 mb-2 px-3 py-2 rounded-md text-xs"
            style={{
              background: "var(--muted)",
              color: "var(--muted-foreground)",
              border: "1px solid var(--border)",
            }}
          >
            {error}
          </div>
        )}

        {/* Composer */}
        <div
          className="shrink-0 px-5 pb-5 pt-2"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{
              border: "1px solid var(--border)",
              background: "var(--muted)",
            }}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message… (Enter to send, Shift+Enter for newline)"
              disabled={isStreaming}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:opacity-50 max-h-40 overflow-y-auto"
              style={{ color: "var(--foreground)" }}
              aria-label="Chat message"
            />
            <button
              onClick={isStreaming ? handleStop : handleSend}
              disabled={!isStreaming && !input.trim()}
              className="shrink-0 p-1.5 rounded-lg transition-opacity disabled:opacity-30"
              style={{
                background: "var(--primary)",
                color: "var(--primary-foreground)",
              }}
              aria-label={isStreaming ? "Stop generating" : "Send message"}
              title={isStreaming ? "Stop generating" : "Send message"}
            >
              {isStreaming ? (
                <Square size={14} fill="currentColor" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
