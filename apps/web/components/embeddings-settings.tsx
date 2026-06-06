"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, RefreshCw, Check, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Embeddings & RAG helper.
 *
 * Surfaces the embedding index status and a one-click re-index, plus guidance:
 * semantic recall needs an `/embeddings`-capable provider (not every chat
 * provider has one). Re-index doubles as a live test — if it embeds > 0 items
 * the active provider's embeddings work; an error or 0/total means it doesn't.
 */
export function EmbeddingsSettings() {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.ragStatus();
      setCount(s.embeddings);
    } catch {
      setCount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleReindex() {
    setIndexing(true);
    setResult(null);
    try {
      const r = await api.ragIndex();
      if (r.total === 0) {
        setResult({ ok: true, msg: "No notes or documents to index yet — add some on the Memory or Documents page, then re-index." });
      } else if (r.indexed > 0) {
        setResult({ ok: true, msg: `Embedded ${r.indexed} of ${r.total} item${r.total === 1 ? "" : "s"}. Your active provider's embeddings work.` });
      } else {
        setResult({ ok: false, msg: `Indexed 0 of ${r.total}. Your active provider may not support /embeddings — try Gemini, an OpenAI-compatible host, or local Ollama.` });
      }
      await loadStatus();
    } catch (e) {
      setResult({
        ok: false,
        msg: e instanceof Error ? e.message : "Re-index failed — check that your active provider supports /embeddings.",
      });
    } finally {
      setIndexing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: "var(--foreground)" }}>
          <Brain size={16} aria-hidden="true" />
          Embeddings &amp; RAG
        </h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
          Semantic recall (Memory/RAG and Research) needs an{" "}
          <code className="font-mono">/embeddings</code>-capable provider. Pinned memories work
          without it. Not every chat provider has embeddings — Groq does not; Gemini, an
          OpenAI-compatible host, or local Ollama do.
        </p>
      </div>

      <div
        className="flex items-center gap-3 p-3 rounded-lg border"
        style={{ borderColor: "var(--border)", background: "var(--muted)" }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm" style={{ color: "var(--foreground)" }}>
            {loading
              ? "Checking…"
              : count === null
                ? "Status unavailable (backend offline)"
                : `${count} item${count === 1 ? "" : "s"} embedded`}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Re-index after adding knowledge or switching to an embeddings provider.
          </p>
        </div>
        <button
          onClick={handleReindex}
          disabled={indexing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium shrink-0 transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <RefreshCw size={13} className={indexing ? "animate-spin" : ""} aria-hidden="true" />
          {indexing ? "Indexing…" : "Re-index"}
        </button>
      </div>

      {result && (
        <div
          className="flex items-start gap-2 px-3 py-2 rounded-md text-xs"
          style={{
            background: "var(--muted)",
            border: "1px solid var(--border)",
            color: result.ok ? "var(--foreground)" : "var(--muted-foreground)",
          }}
        >
          {result.ok ? (
            <Check size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <span>{result.msg}</span>
        </div>
      )}
    </div>
  );
}
