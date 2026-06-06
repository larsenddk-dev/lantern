"use client";

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ["⌘ K", "Ctrl K"], description: "Open command palette / global search" },
  { keys: ["⌘ 1-9", "Ctrl 1-9"], description: "Jump to a nav page (Chat is 1, Agent is 2, …)" },
  { keys: ["?"], description: "Show this shortcuts cheat-sheet" },
  { keys: ["Esc"], description: "Close any modal" },
  { keys: ["Enter"], description: "Send message (in chat)" },
  { keys: ["Shift + Enter"], description: "Newline (in chat)" },
  { keys: ["↑ ↓"], description: "Navigate command palette results" },
];

/**
 * Press "?" anywhere outside an input to open the shortcuts cheat-sheet.
 */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      e.preventDefault();
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-md mx-4 rounded-xl border overflow-hidden shadow-2xl"
        style={{ background: "var(--background)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <Keyboard size={15} aria-hidden="true" />
          <h2 className="text-sm font-semibold flex-1">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="p-1 rounded-md hover:opacity-70"
            style={{ color: "var(--muted-foreground)" }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <ul className="p-2">
          {SHORTCUTS.map((s, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="flex-1">{s.description}</span>
              <span className="flex gap-1 shrink-0">
                {s.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="text-[11px] px-1.5 py-0.5 rounded border font-sans"
                    style={{
                      borderColor: "var(--border)",
                      color: "var(--muted-foreground)",
                      background: "var(--muted)",
                    }}
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
