"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Bot, Telescope, Columns2, FileText, StickyNote,
  CheckSquare, Brain, Settings, Plus, Search, CornerDownLeft,
} from "lucide-react";

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number }>;
  path: string;
  keywords?: string;
};

const COMMANDS: Cmd[] = [
  { id: "new-chat", label: "New chat", hint: "Start a conversation", icon: Plus, path: "/chat", keywords: "message ask new" },
  { id: "chat", label: "Go to Chat", icon: MessageSquare, path: "/chat" },
  { id: "agent", label: "Go to Agent", icon: Bot, path: "/agent", keywords: "tools" },
  { id: "research", label: "Go to Research", icon: Telescope, path: "/research", keywords: "deep report" },
  { id: "compare", label: "Go to Compare", icon: Columns2, path: "/compare", keywords: "models side by side" },
  { id: "documents", label: "Go to Documents", icon: FileText, path: "/documents", keywords: "upload files pdf docx" },
  { id: "notes", label: "Go to Notes", icon: StickyNote, path: "/notes" },
  { id: "tasks", label: "Go to Tasks", icon: CheckSquare, path: "/tasks", keywords: "todo" },
  { id: "memory", label: "Go to Memory", icon: Brain, path: "/memory", keywords: "remember facts rag" },
  { id: "settings", label: "Go to Settings", icon: Settings, path: "/settings", keywords: "providers embeddings api key" },
];

/**
 * Global ⌘K / Ctrl+K command palette — fuzzy-search and jump anywhere.
 * Mounted once in the root layout.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => (c.label + " " + (c.keywords ?? "")).toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  function run(i: number) {
    const cmd = results[i];
    if (!cmd) return;
    setOpen(false);
    router.push(cmd.path);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg mx-4 rounded-xl border overflow-hidden shadow-2xl"
        style={{ background: "var(--background)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b" style={{ borderColor: "var(--border)" }}>
          <Search size={15} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(active);
              }
            }}
            placeholder="Type a command or search…"
            className="flex-1 py-3 bg-transparent text-sm outline-none"
            style={{ color: "var(--foreground)" }}
            aria-label="Command palette search"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
            ESC
          </kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm" style={{ color: "var(--muted-foreground)" }}>
              No commands match.
            </li>
          ) : (
            results.map((c, i) => {
              const Icon = c.icon;
              return (
                <li key={c.id}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(i)}
                    className="flex items-center gap-3 w-full px-3 py-2 text-left text-sm"
                    style={{
                      background: i === active ? "var(--muted)" : "transparent",
                      color: "var(--foreground)",
                    }}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span className="flex-1">{c.label}</span>
                    {c.hint && (
                      <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                        {c.hint}
                      </span>
                    )}
                    {i === active && (
                      <CornerDownLeft size={13} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
