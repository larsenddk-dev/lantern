"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Plus, MessageSquare, Loader2, Square, Brain, Download, Copy, Check, Pencil, Trash2, Star, RefreshCw, Pause, Play, ListChecks, X, PanelRight, KeyRound, ArrowRight, Paperclip } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Session, Message, Provider } from "@/lib/types";
import { ProviderSwitcher } from "@/components/provider-switcher";
import { Markdown } from "@/components/markdown";
import { CanvasPanel } from "@/components/canvas-panel";
import type { Artifact } from "@/lib/artifacts";
import {
  artifactFromMessage, hasArtifact, extractArtifactBlock, languageLabel,
} from "@/lib/artifacts";
import { chatToMarkdown, downloadText, downloadPdf, slugify } from "@/lib/export";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StreamingMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  starred?: boolean;
  attachments?: import("@/lib/types").MessageAttachment[];
}

/** A composer-side attachment, before it's been POSTed. Carries the inline
 * preview (object URL) so we can show it next to the textarea without
 * round-tripping through the backend. */
interface DraftAttachment {
  id: string;            // local-only id; never sent
  filename: string;
  mime_type: string;
  size_bytes: number;
  data_base64: string;   // sent to the API
  previewUrl: string;    // blob: URL for the <img> preview
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per attachment
const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Read a File into a base64 string (no data: prefix). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      // result is "data:<mime>;base64,<payload>" — strip the prefix.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
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

function MessageBubble({
  msg,
  onToggleStar,
  onRetry,
  onEdit,
  onDelete,
  onOpenCanvas,
}: {
  msg: StreamingMessage;
  onToggleStar?: (id: string, starred: boolean) => void;
  onRetry?: (id: string) => void;
  onEdit?: (id: string, content: string) => Promise<void>;
  onDelete?: (id: string) => void;
  onOpenCanvas?: (id: string, content: string) => void;
}) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const [savingEdit, setSavingEdit] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }
  // Persisted messages have non-tmp ids (used to enable star / retry / edit / delete).
  const persisted = !msg.id.startsWith("tmp-");
  const canStar = persisted && !msg.streaming && msg.content.trim() && onToggleStar;
  const canRetry = !isUser && persisted && !msg.streaming && onRetry;
  const canEdit = persisted && !msg.streaming && onEdit;
  const canDelete = persisted && !msg.streaming && onDelete;
  // Assistant replies carrying a substantial code/document block can open in Canvas.
  const canCanvas = !isUser && !msg.streaming && !!msg.content.trim() && !!onOpenCanvas && hasArtifact(msg.content);

  async function commitEdit() {
    const next = draft.trim();
    if (!onEdit || !next || next === msg.content) {
      setEditing(false);
      setDraft(msg.content);
      return;
    }
    setSavingEdit(true);
    try {
      await onEdit(msg.id, next);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  }

  if (editing) {
    return (
      <div className={cn("group flex flex-col w-full gap-1", isUser ? "items-end" : "items-start")}>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(10, Math.max(2, draft.split("\n").length))}
          className="w-full max-w-[72%] px-3 py-2 rounded-2xl text-sm border outline-none resize-y"
          style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
          aria-label="Edit message"
        />
        <div className="flex items-center gap-1">
          <button
            onClick={commitEdit}
            disabled={savingEdit}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] disabled:opacity-40"
            style={{ color: "var(--muted-foreground)" }}
            title="Save edit"
          >
            <Check size={11} aria-hidden="true" />
            {savingEdit ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(msg.content); }}
            disabled={savingEdit}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] disabled:opacity-40"
            style={{ color: "var(--muted-foreground)" }}
            title="Cancel edit"
          >
            <X size={11} aria-hidden="true" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const imageAttachments = (msg.attachments ?? []).filter(
    (a) => a.kind === "image",
  );

  // While the message is still optimistic (id starts with "draft-"), we
  // render from the blob: URL we created at upload time. Once the page
  // is reloaded, the real attachment id surfaces and the API URL takes over.
  function attachmentSrc(att: { id: string; _previewUrl?: string }): string {
    if (att.id.startsWith("draft-") && att._previewUrl) return att._previewUrl;
    return api.attachmentUrl(att.id);
  }

  return (
    <div className={cn("group flex flex-col w-full", isUser ? "items-end" : "items-start")}>
      {/* Image thumbnails. Sit above the bubble on user messages so the
          textual reply still reads bottom-up; the bubble width adapts. */}
      {imageAttachments.length > 0 && (
        <div className={cn("flex flex-wrap gap-2 mb-1 max-w-[72%]",
                           isUser ? "justify-end" : "justify-start")}>
          {imageAttachments.map((att) => {
            const src = attachmentSrc(att as { id: string; _previewUrl?: string });
            return (
              <a
                key={att.id}
                href={src}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg overflow-hidden border"
                style={{ borderColor: "var(--border)" }}
                title={att.filename ?? "image"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={att.filename ?? "attached image"}
                  className="block max-h-48 max-w-[16rem] object-cover"
                />
              </a>
            );
          })}
        </div>
      )}
      <div
        className={cn(
          "max-w-[72%] px-4 py-2 rounded-2xl text-sm leading-relaxed break-words",
          isUser ? "rounded-br-sm whitespace-pre-wrap" : "rounded-bl-sm",
          // If there's no text but there ARE images, hide the empty bubble.
          !msg.content && imageAttachments.length > 0 && "hidden"
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
      {!msg.streaming && (msg.content.trim() || imageAttachments.length > 0) && (
        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={copy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
            style={{ color: "var(--muted-foreground)" }}
            title="Copy message"
          >
            {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {canCanvas && (
            <button
              onClick={() => onOpenCanvas(msg.id, msg.content)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
              style={{ color: "var(--primary)" }}
              title="Open in Canvas — edit, preview and iterate"
            >
              <PanelRight size={11} aria-hidden="true" />
              Canvas
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => { setDraft(msg.content); setEditing(true); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
              style={{ color: "var(--muted-foreground)" }}
              title="Edit message"
            >
              <Pencil size={11} aria-hidden="true" />
              Edit
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(msg.id)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
              style={{ color: "var(--muted-foreground)" }}
              title="Delete message"
            >
              <Trash2 size={11} aria-hidden="true" />
              Delete
            </button>
          )}
          {canStar && (
            <button
              onClick={() => onToggleStar(msg.id, !msg.starred)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
              style={{ color: msg.starred ? "var(--primary)" : "var(--muted-foreground)" }}
              title={msg.starred ? "Unstar message" : "Star message"}
            >
              <Star
                size={11}
                aria-hidden="true"
                fill={msg.starred ? "currentColor" : "none"}
              />
              {msg.starred ? "Starred" : "Star"}
            </button>
          )}
          {canRetry && (
            <button
              onClick={() => onRetry(msg.id)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]"
              style={{ color: "var(--muted-foreground)" }}
              title="Regenerate this reply"
            >
              <RefreshCw size={11} aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      )}
      {/* Always-visible star indicator when starred */}
      {!msg.streaming && msg.starred && !canStar && (
        <Star
          size={11}
          aria-hidden="true"
          fill="currentColor"
          className="mt-1"
          style={{ color: "var(--primary)" }}
        />
      )}
    </div>
  );
}

function SessionItem({
  session,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onClick: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  function commit() {
    setEditing(false);
    const t = draft.trim();
    if (t && t !== session.title) onRename(session.id, t);
    else setDraft(session.title);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") {
            setDraft(session.title);
            setEditing(false);
          }
        }}
        className="w-full px-3 py-2 rounded-md text-xs outline-none"
        style={{ background: "var(--muted)", color: "var(--foreground)", border: "1px solid var(--border)" }}
        aria-label="Rename conversation"
      />
    );
  }

  return (
    <div className="group/sess flex items-center gap-0.5">
      <button
        onClick={onClick}
        className={cn(
          "flex-1 min-w-0 text-left px-3 py-2 rounded-md text-xs truncate transition-colors",
          active ? "font-semibold" : "hover:opacity-80"
        )}
        style={{
          background: active ? "var(--sidebar-item-active)" : "transparent",
          color: active ? "var(--sidebar-item-active-text)" : "var(--sidebar-text)",
        }}
        title={session.title}
      >
        {session.title}
      </button>
      <div className="flex items-center opacity-0 group-hover/sess:opacity-100 transition-opacity shrink-0">
        <button
          onClick={() => { setDraft(session.title); setEditing(true); }}
          className="p-1 rounded hover:opacity-80"
          style={{ color: "var(--muted-foreground)" }}
          title="Rename"
          aria-label="Rename conversation"
        >
          <Pencil size={11} />
        </button>
        <button
          onClick={() => onDelete(session.id)}
          className="p-1 rounded hover:opacity-80"
          style={{ color: "var(--muted-foreground)" }}
          title="Delete"
          aria-label="Delete conversation"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
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
  // null = unknown/loading, true/false once we've checked. Drives the empty
  // state: with no provider, "Start a conversation" would lie — the first
  // message would just error — so we guide the user to set one up instead.
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [useContext, setUseContext] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  // Canvas / Artifacts — the artifact currently open in the side panel, and
  // whether an AI revision of it is streaming.
  const [canvas, setCanvas] = useState<Artifact | null>(null);
  const [canvasAiBusy, setCanvasAiBusy] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Pause/resume: while paused, incoming deltas accumulate here instead of
  // rendering, and flush back into the message on resume / stream end.
  const pausedRef = useRef(false);
  const pendingRef = useRef("");

  // Composer-side images queued for the NEXT send. Each holds the bytes
  // (base64, what the API wants) plus a blob: URL we use for the inline
  // preview thumbnail. We revoke the blob URLs on cleanup to avoid leaking
  // memory across long sessions.
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) return;
    const accepted: DraftAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!SUPPORTED_IMAGE_MIME.has(file.type)) {
        toast(`Unsupported file type: ${file.type || file.name}`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast(`${file.name} is too large (max 10 MB)`);
        continue;
      }
      try {
        const data_base64 = await readFileAsBase64(file);
        accepted.push({
          id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          filename: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          data_base64,
          previewUrl: URL.createObjectURL(file),
        });
      } catch {
        toast(`Couldn't read ${file.name}`);
      }
    }
    if (accepted.length) setDrafts((prev) => [...prev, ...accepted]);
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => {
      const gone = prev.find((d) => d.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((d) => d.id !== id);
    });
  }, []);

  const clearDrafts = useCallback(() => {
    setDrafts((prev) => {
      prev.forEach((d) => URL.revokeObjectURL(d.previewUrl));
      return [];
    });
  }, []);

  // Revoke any remaining blob URLs on unmount so we don't leak.
  useEffect(() => {
    return () => {
      drafts.forEach((d) => URL.revokeObjectURL(d.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Check whether any provider is configured, so the empty state can guide a
  // brand-new user to set one up instead of inviting a message that'll error.
  useEffect(() => {
    api
      .listProviders()
      .then((list) => setHasProvider(list.length > 0))
      .catch(() => setHasProvider(null));
  }, []);

  const loadSession = useCallback(async (id: string) => {
    setLoadingSession(true);
    setError(null);
    try {
      const [detail, starred] = await Promise.all([
        api.getSession(id),
        api.listStarredMessages().catch(() => []),
      ]);
      const starredIds = new Set(starred.map((m) => m.id));
      setActiveSessionId(id);
      setMessages(
        detail.messages.map((m: Message) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          starred: starredIds.has(m.id),
          attachments: m.attachments ?? [],
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const handleToggleStar = useCallback(async (id: string, starred: boolean) => {
    // Optimistic toggle
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, starred } : m))
    );
    try {
      if (starred) await api.starMessage(id);
      else await api.unstarMessage(id);
    } catch {
      // Revert on failure
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, starred: !starred } : m))
      );
    }
  }, []);

  // Deep-link: open a specific session when arriving via search (?focus=<id>).
  // Uses window.location to avoid the static-export useSearchParams/Suspense gotcha.
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    // URL-driven side effect on mount is exactly what we want here, even
    // though it kicks off setState in the callback.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (focus) loadSession(focus);
  }, [loadSession]);

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

  const handleRenameSession = useCallback(async (id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    try {
      await api.renameSession(id, title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename conversation");
      api.listSessions().then(setSessions).catch(() => {});
    }
  }, []);

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (!confirm("Delete this conversation? This cannot be undone.")) return;
      try {
        await api.deleteSession(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
          setMessages([]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete conversation");
      }
    },
    [activeSessionId],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    // Allow sending with an image and no text — vision-only "what's this?".
    if ((!text && drafts.length === 0) || isStreaming) return;
    setError(null);

    let sessionId = activeSessionId;

    // Auto-create session if none is active
    if (!sessionId) {
      try {
        const session = await api.createSession(
          (text || drafts[0]?.filename || "Image chat").slice(0, 50),
        );
        setSessions((prev) => [session, ...prev]);
        sessionId = session.id;
        setActiveSessionId(session.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create session");
        return;
      }
    }

    // Snapshot the drafts for sending; clear the composer immediately so the
    // user sees the message + thumbnails flip from composer to history.
    const sending = drafts;
    setDrafts([]);
    const optimisticAttachments = sending.map((d) => ({
      id: d.id,            // local id; replaced on next session reload
      message_id: "",
      kind: "image" as const,
      mime_type: d.mime_type,
      filename: d.filename,
      size_bytes: d.size_bytes,
      created_at: new Date().toISOString(),
      // Object URL: works for the optimistic render only.
      _previewUrl: d.previewUrl,
    }));

    // Optimistic user message
    const userMsg: StreamingMessage = {
      id: `tmp-user-${Date.now()}`,
      role: "user",
      content: text,
      // Cast: the optimistic attachment carries a transient previewUrl
      // field that the persisted type doesn't have; the renderer falls
      // back to the API URL once a real id is in place.
      attachments: optimisticAttachments as unknown as StreamingMessage["attachments"],
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
            // Stream ended — flush any paused buffer, mark done, refresh list
            const buffered = pendingRef.current;
            pendingRef.current = "";
            pausedRef.current = false;
            setIsPaused(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + buffered, streaming: false }
                  : m
              )
            );
            api.listSessions().then(setSessions).catch(() => {});
          } else if (pausedRef.current) {
            pendingRef.current += delta;
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
        sending.map((d) => ({
          filename: d.filename,
          mime_type: d.mime_type,
          data_base64: d.data_base64,
        })),
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
      // Flush any buffered (paused) tokens and clear the streaming cursor.
      const buffered = pendingRef.current;
      pendingRef.current = "";
      pausedRef.current = false;
      setIsPaused(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.streaming ? { ...m, content: m.content + buffered, streaming: false } : m
        )
      );
      // The persisted attachments come back next time loadSession runs.
      // Revoke the object URLs we held for the optimistic render so we don't
      // leak — by then the <img>s have either been replaced by real /attachments
      // URLs (after a refresh) or we just lose the inline preview on next mount.
      sending.forEach((d) => URL.revokeObjectURL(d.previewUrl));
    }
  }, [input, drafts, isStreaming, activeSessionId, activeProvider, useContext]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handlePause = useCallback(() => {
    pausedRef.current = true;
    setIsPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    pausedRef.current = false;
    setIsPaused(false);
    // Flush whatever streamed in while paused into the active message.
    const buffered = pendingRef.current;
    pendingRef.current = "";
    if (buffered) {
      setMessages((prev) =>
        prev.map((m) => (m.streaming ? { ...m, content: m.content + buffered } : m))
      );
    }
  }, []);

  const handleEditMessage = useCallback(async (id: string, content: string) => {
    const prevContent = messages.find((m) => m.id === id)?.content;
    // Optimistic update
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)));
    try {
      await api.updateMessage(id, content);
    } catch {
      // Revert on failure
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: prevContent ?? m.content } : m))
      );
      toast("Failed to edit message");
    }
  }, [messages]);

  const handleDeleteMessage = useCallback(async (id: string) => {
    if (!confirm("Delete this message? This cannot be undone.")) return;
    const snapshot = messages;
    setMessages((prev) => prev.filter((m) => m.id !== id));
    try {
      await api.deleteMessage(id);
    } catch {
      setMessages(snapshot);
      toast("Failed to delete message");
    }
  }, [messages]);

  const handleGenerateTasks = useCallback(async () => {
    if (!activeSessionId || generatingTasks) return;
    setGeneratingTasks(true);
    try {
      const res = await api.generateTasks({ session_id: activeSessionId });
      toast(
        res.count > 0
          ? `Created ${res.count} task${res.count === 1 ? "" : "s"} — see the Tasks page`
          : "No actionable tasks found in this chat",
        res.count > 0 ? "success" : undefined,
      );
    } catch {
      toast("Couldn't generate tasks");
    } finally {
      setGeneratingTasks(false);
    }
  }, [activeSessionId, generatingTasks]);

  const handleRetry = useCallback(async (assistantId: string) => {
    if (isStreaming || !activeSessionId) return;
    // Find the user message that produced this assistant reply.
    const idx = messages.findIndex((m) => m.id === assistantId);
    if (idx <= 0) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && messages[userIdx].role !== "user") userIdx -= 1;
    if (userIdx < 0) return;
    const userText = messages[userIdx].content;

    // Drop the assistant reply and stream a fresh one in its place.
    const newAssistantId = `tmp-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev.slice(0, idx),
      { id: newAssistantId, role: "assistant", content: "", streaming: true },
    ]);
    setIsStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      await api.streamChat(
        activeSessionId,
        userText,
        (delta) => {
          if (delta === null) {
            const buffered = pendingRef.current;
            pendingRef.current = "";
            pausedRef.current = false;
            setIsPaused(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === newAssistantId
                  ? { ...m, content: m.content + buffered, streaming: false }
                  : m
              )
            );
          } else if (pausedRef.current) {
            pendingRef.current += delta;
          } else {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === newAssistantId ? { ...m, content: m.content + delta } : m
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
        setError(e instanceof Error ? e.message : "Retry failed");
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      const buffered = pendingRef.current;
      pendingRef.current = "";
      pausedRef.current = false;
      setIsPaused(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.streaming ? { ...m, content: m.content + buffered, streaming: false } : m
        )
      );
    }
  }, [messages, isStreaming, activeSessionId, activeProvider, useContext]);

  // ---- Canvas / Artifacts -------------------------------------------------

  const handleOpenCanvas = useCallback((id: string, content: string) => {
    const artifact = artifactFromMessage(id, content);
    if (artifact) setCanvas(artifact);
  }, []);

  // Manual edit of the current version — mutate in place (no new version).
  const handleCanvasEdit = useCallback((content: string) => {
    setCanvas((prev) => {
      if (!prev) return prev;
      const versions = [...prev.versions];
      versions[prev.current] = content;
      return { ...prev, versions };
    });
  }, []);

  const handleCanvasSelectVersion = useCallback((index: number) => {
    setCanvas((prev) => (prev ? { ...prev, current: index } : prev));
  }, []);

  // Ask the model to revise the open artifact. Rides the normal chat stream so
  // the iteration is part of the conversation; the reply's code block becomes a
  // new version appended to the canvas.
  const handleCanvasAiEdit = useCallback(async (instruction: string) => {
    if (!canvas || !activeSessionId || isStreaming || canvasAiBusy) return;
    const current = canvas.versions[canvas.current] ?? "";
    const lang = canvas.language;
    const prompt =
      `Revise the canvas "${canvas.title}". ${instruction}\n\n` +
      `Return the COMPLETE updated ${languageLabel(lang)} as a single fenced ` +
      `\`\`\`${lang} code block (no commentary outside it).\n\n` +
      `Current content:\n\`\`\`${lang}\n${current}\n\`\`\``;

    const userMsg: StreamingMessage = { id: `tmp-user-${Date.now()}`, role: "user", content: instruction };
    const assistantId = `tmp-assistant-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "", streaming: true }]);
    setIsStreaming(true);
    setCanvasAiBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    let finalText = "";
    try {
      await api.streamChat(
        activeSessionId,
        prompt,
        (delta) => {
          if (delta === null) return;
          finalText += delta;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          );
        },
        abort.signal,
        activeProvider?.id,
        activeProvider?.model,
        useContext,
      );
      const block = extractArtifactBlock(finalText);
      if (block) {
        setCanvas((prev) =>
          prev
            ? { ...prev, versions: [...prev.versions, block.code], current: prev.versions.length }
            : prev,
        );
      } else {
        toast("Lantern's reply had no code block to apply");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast("Canvas edit failed");
    } finally {
      setIsStreaming(false);
      setCanvasAiBusy(false);
      abortRef.current = null;
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)),
      );
      api.listSessions().then(setSessions).catch(() => {});
    }
  }, [canvas, activeSessionId, isStreaming, canvasAiBusy, activeProvider, useContext]);

  function chatTitle() {
    return (activeSessionId ? sessions.find((s) => s.id === activeSessionId)?.title : null) ?? "Chat";
  }

  function exportChat() {
    const title = chatTitle();
    downloadText(`${slugify(title)}.md`, chatToMarkdown(title, messages));
  }

  function exportChatPdf() {
    const title = chatTitle();
    const body = messages
      .filter((m) => m.content.trim())
      .map((m) => `${m.role === "user" ? "You" : "Lantern"}:\n${m.content.trim()}`)
      .join("\n\n");
    downloadPdf(`${slugify(title)}.pdf`, title, body);
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
                onRename={handleRenameSession}
                onDelete={handleDeleteSession}
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
          {messages.length > 0 && activeSessionId && (
            <button
              type="button"
              onClick={handleGenerateTasks}
              disabled={generatingTasks}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-opacity hover:opacity-80 disabled:opacity-40 shrink-0"
              style={{ color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
              title="Extract actionable tasks from this conversation"
            >
              {generatingTasks ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : (
                <ListChecks size={13} aria-hidden="true" />
              )}
              Tasks
            </button>
          )}
          {messages.length > 0 && (
            <>
              <button
                type="button"
                onClick={exportChat}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-opacity hover:opacity-80 shrink-0"
                style={{ color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
                title="Export this conversation as Markdown"
              >
                <Download size={13} aria-hidden="true" />
                .md
              </button>
              <button
                type="button"
                onClick={exportChatPdf}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-opacity hover:opacity-80 shrink-0"
                style={{ color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
                title="Export this conversation as PDF"
              >
                <Download size={13} aria-hidden="true" />
                .pdf
              </button>
            </>
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
          ) : messages.length === 0 && hasProvider === false ? (
            <div
              className="flex flex-col items-center justify-center h-full gap-3 text-center"
              style={{ color: "var(--muted-foreground)" }}
            >
              <KeyRound size={40} aria-hidden="true" />
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                Add a provider to get started
              </p>
              <p className="text-xs max-w-xs">
                Lantern needs one AI provider before it can chat. Add an API key —
                or run a model locally — and you&rsquo;re live.
              </p>
              <Link
                href="/welcome"
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                Set up a provider
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
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
                <MessageBubble
                  key={m.id}
                  msg={m}
                  onToggleStar={handleToggleStar}
                  onRetry={handleRetry}
                  onEdit={handleEditMessage}
                  onDelete={handleDeleteMessage}
                  onOpenCanvas={handleOpenCanvas}
                />
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
          className="shrink-0 px-5 pb-5 pt-2 relative"
          style={{ borderTop: "1px solid var(--border)" }}
          onDragEnter={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            // Leaving the composer wrapper itself, not just child elements
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer?.files ?? null);
          }}
        >
          {dragOver && (
            <div
              className="absolute inset-3 z-10 rounded-xl border-2 border-dashed flex items-center justify-center pointer-events-none"
              style={{
                borderColor: "var(--primary)",
                background: "color-mix(in srgb, var(--primary) 8%, transparent)",
                color: "var(--primary)",
              }}
            >
              <p className="text-sm font-medium">Drop image to attach</p>
            </div>
          )}

          {/* Draft thumbnails — what's queued for the next send */}
          {drafts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="relative group/draft rounded-md overflow-hidden border"
                  style={{ borderColor: "var(--border)" }}
                  title={`${d.filename} · ${(d.size_bytes / 1024).toFixed(0)} KB`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={d.previewUrl}
                    alt={d.filename}
                    className="block w-14 h-14 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeDraft(d.id)}
                    aria-label={`Remove ${d.filename}`}
                    className="absolute top-0.5 right-0.5 p-0.5 rounded-full transition-opacity opacity-0 group-hover/draft:opacity-100"
                    style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
                  >
                    <X size={10} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{
              border: "1px solid var(--border)",
              background: "var(--muted)",
            }}
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className="shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-30"
              style={{ color: "var(--muted-foreground)" }}
              aria-label="Attach image"
              title="Attach image (or drag-drop / paste into the message)"
            >
              <Paperclip size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                // Reset so the same file can be picked twice in a row.
                e.target.value = "";
              }}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                const files: File[] = [];
                for (const item of Array.from(items)) {
                  if (item.kind === "file") {
                    const f = item.getAsFile();
                    if (f && SUPPORTED_IMAGE_MIME.has(f.type)) files.push(f);
                  }
                }
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              placeholder={
                drafts.length > 0
                  ? "Say something about the image…"
                  : "Message… (Enter to send, Shift+Enter for newline)"
              }
              disabled={isStreaming}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:opacity-50 max-h-40 overflow-y-auto"
              style={{ color: "var(--foreground)" }}
              aria-label="Chat message"
            />
            {isStreaming && (
              <button
                onClick={isPaused ? handleResume : handlePause}
                className="shrink-0 p-1.5 rounded-lg transition-opacity hover:opacity-80"
                style={{ color: "var(--foreground)", border: "1px solid var(--border)" }}
                aria-label={isPaused ? "Resume generating" : "Pause generating"}
                title={isPaused ? "Resume — show buffered text" : "Pause — hold incoming text"}
              >
                {isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
              </button>
            )}
            <button
              onClick={isStreaming ? handleStop : handleSend}
              disabled={!isStreaming && !input.trim() && drafts.length === 0}
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

      {/* Canvas / Artifacts side panel */}
      {canvas && (
        <div
          className="shrink-0 hidden md:flex"
          style={{ width: "min(46%, 720px)", minWidth: 360 }}
        >
          <CanvasPanel
            artifact={canvas}
            onEditContent={handleCanvasEdit}
            onSelectVersion={handleCanvasSelectVersion}
            onAiEdit={handleCanvasAiEdit}
            onClose={() => setCanvas(null)}
            aiBusy={canvasAiBusy}
          />
        </div>
      )}
    </div>
  );
}
