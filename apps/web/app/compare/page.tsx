"use client";

import { useState, useEffect, useCallback } from "react";
import { Columns2, Play } from "lucide-react";
import { api } from "@/lib/api";
import type { Provider, CompareResult } from "@/lib/types";

export default function ComparePage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<CompareResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const ps = await api.listProviders();
      setProviders(ps);
      // Preselect up to the first 2 providers.
      setSelected(new Set(ps.slice(0, 2).map((p) => p.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load providers");
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    if (!prompt.trim() || selected.size === 0) return;
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const targets = Array.from(selected).map((id) => ({ provider_id: id }));
      const res = await api.compare(prompt, targets);
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setRunning(false);
    }
  }

  const selectedProviders = providers.filter((p) => selected.has(p.id));

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Columns2 size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Compare</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          One prompt, multiple models, side by side
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {providers.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Add at least one provider in <strong>Settings</strong> to compare models.
          </p>
        ) : (
          <>
            {/* Provider selection */}
            <div className="flex flex-wrap gap-2 mb-4">
              {providers.map((p) => {
                const on = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                    style={{
                      borderColor: on ? "var(--primary)" : "var(--border)",
                      background: on ? "var(--primary)" : "transparent",
                      color: on ? "var(--primary-foreground)" : "var(--foreground)",
                    }}
                  >
                    {p.label} · {p.model}
                  </button>
                );
              })}
            </div>

            {/* Prompt */}
            <div className="flex gap-2 mb-5">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter a prompt to send to all selected models…"
                rows={3}
                className="flex-1 px-3 py-2 rounded-md text-sm border outline-none resize-y"
                style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
              />
              <button
                type="button"
                onClick={run}
                disabled={running || !prompt.trim() || selected.size === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium self-start transition-opacity disabled:opacity-40"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                <Play size={14} aria-hidden="true" />
                {running ? "Running…" : "Compare"}
              </button>
            </div>

            {error && (
              <div
                className="px-3 py-2 rounded-md text-xs mb-4"
                style={{ background: "var(--destructive, #fee)", color: "var(--destructive-foreground, #900)" }}
              >
                {error}
              </div>
            )}

            {/* Results columns */}
            {(running || results) && (
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: `repeat(${Math.max(selectedProviders.length, 1)}, minmax(0, 1fr))` }}
              >
                {(results
                  ? results
                  : selectedProviders.map((p) => ({ model: p.model, reply: "", error: null }))
                ).map((r, i) => (
                  <div
                    key={i}
                    className="rounded-md border p-3 min-h-[8rem]"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <p className="text-xs font-semibold mb-2 truncate" title={r.model}>{r.model}</p>
                    {running && !results ? (
                      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Waiting…</p>
                    ) : r.error ? (
                      <p className="text-xs" style={{ color: "var(--destructive-foreground, #900)" }}>
                        Error: {r.error}
                      </p>
                    ) : (
                      <p className="text-xs whitespace-pre-wrap break-words leading-relaxed">{r.reply}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
