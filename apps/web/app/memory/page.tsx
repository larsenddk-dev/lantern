"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, Plus, Trash2, Pin, PinOff, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Memory } from "@/lib/types";

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexed, setIndexed] = useState<number | null>(null);
  const [indexing, setIndexing] = useState(false);

  const load = useCallback(async () => {
    try {
      setMemories(await api.listMemories());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      setIndexed((await api.ragStatus()).embeddings);
    } catch {
      /* status is best-effort */
    }
  }, []);

  useEffect(() => {
    load();
    loadStatus();
  }, [load, loadStatus]);

  async function handleReindex() {
    setIndexing(true);
    setError(null);
    try {
      await api.ragIndex();
      await loadStatus();
    } catch (e) {
      setError(
        e instanceof Error
          ? `Indexing failed (needs an embedding provider): ${e.message}`
          : "Indexing failed",
      );
    } finally {
      setIndexing(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      await api.createMemory({ content });
      setDraft("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(m: Memory) {
    try {
      await api.updateMemory(m.id, { pinned: !m.pinned });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteMemory(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Brain size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Memory</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Facts your assistant keeps across sessions
        </span>
        <div className="ml-auto flex items-center gap-3">
          {indexed !== null && (
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {indexed} chunk{indexed === 1 ? "" : "s"} indexed for chat
            </span>
          )}
          <button
            type="button"
            onClick={handleReindex}
            disabled={indexing}
            title="Embed memories & documents so chat can retrieve them (needs an embedding provider)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-opacity disabled:opacity-40"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            <RefreshCw size={13} aria-hidden="true" className={indexing ? "animate-spin" : ""} />
            {indexing ? "Indexing…" : "Re-index"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto">
        {/* Add form */}
        <form onSubmit={handleAdd} className="flex gap-2 mb-5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Remember something… (e.g. 'I prefer concise answers')"
            className="flex-1 px-3 py-2 rounded-md text-sm border outline-none"
            style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
          />
          <button
            type="submit"
            disabled={saving || !draft.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <Plus size={14} aria-hidden="true" />
            Remember
          </button>
        </form>

        {error && (
          <div
            className="px-3 py-2 rounded-md text-xs mb-4"
            style={{ background: "var(--destructive, #fee)", color: "var(--destructive-foreground, #900)" }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center py-16">
            <Brain size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm font-medium">No memories yet</p>
            <p className="text-xs max-w-xs" style={{ color: "var(--muted-foreground)" }}>
              Add facts you want the assistant to remember. Pinned memories are
              always considered; the rest are retrieved by relevance (RAG).
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {memories.map((m) => (
              <li
                key={m.id}
                className="flex items-start gap-3 px-3 py-2.5 rounded-md border"
                style={{ borderColor: "var(--border)" }}
              >
                <button
                  type="button"
                  onClick={() => togglePin(m)}
                  aria-label={m.pinned ? "Unpin" : "Pin"}
                  className="p-1 rounded-md hover:opacity-70 shrink-0"
                  style={{ color: m.pinned ? "var(--primary)" : "var(--muted-foreground)" }}
                >
                  {m.pinned ? <Pin size={15} /> : <PinOff size={15} />}
                </button>
                <p className="text-sm flex-1 break-words">{m.content}</p>
                <button
                  type="button"
                  onClick={() => handleDelete(m.id)}
                  aria-label="Delete memory"
                  className="p-1 rounded-md hover:opacity-70 shrink-0"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
