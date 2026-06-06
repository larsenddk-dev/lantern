"use client";

import { useState } from "react";
import { Telescope, Play, ChevronDown, ChevronRight, FileText, Brain, Download } from "lucide-react";
import { api } from "@/lib/api";
import type { ResearchResponse } from "@/lib/types";
import { Markdown } from "@/components/markdown";
import { downloadText, slugify } from "@/lib/export";

export default function ResearchPage() {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openFindings, setOpenFindings] = useState(true);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.research(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Research failed");
    } finally {
      setRunning(false);
    }
  }

  function exportReport() {
    if (!result) return;
    const md = `# Research: ${question}\n\n*Exported from Lantern*\n\n${result.report}\n`;
    downloadText(`research-${slugify(question)}.md`, md);
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Telescope size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Research</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Plans sub-questions, gathers from your knowledge, writes a report
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={run} className="flex gap-2 mb-5 max-w-3xl">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a research question…"
            disabled={running}
            className="flex-1 px-3 py-2 rounded-md text-sm border outline-none"
            style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
          />
          <button
            type="submit"
            disabled={running || !question.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <Play size={14} aria-hidden="true" />
            {running ? "Researching…" : "Research"}
          </button>
        </form>

        {error && (
          <div className="px-3 py-2 rounded-md text-xs mb-4 max-w-3xl"
               style={{ background: "var(--destructive, #fee)", color: "var(--destructive-foreground, #900)" }}>
            {error}
          </div>
        )}

        {running && !result && (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Planning sub-questions, searching your knowledge, and writing the report…
          </p>
        )}

        {result && (
          <div className="max-w-3xl flex flex-col gap-5">
            {/* Sub-questions + sources */}
            <div className="rounded-md border text-xs" style={{ borderColor: "var(--border)" }}>
              <button
                type="button"
                onClick={() => setOpenFindings((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 w-full text-left"
                style={{ color: "var(--muted-foreground)" }}
              >
                {openFindings ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {result.subquestions.length} sub-question{result.subquestions.length === 1 ? "" : "s"} ·
                {" "}{result.findings.reduce((n, f) => n + f.sources.length, 0)} source{result.findings.reduce((n, f) => n + f.sources.length, 0) === 1 ? "" : "s"} from your knowledge
              </button>
              {openFindings && (
                <div className="px-3 pb-3 flex flex-col gap-3">
                  {result.findings.map((f, i) => (
                    <div key={i}>
                      <p className="font-medium mb-1">{f.subquestion}</p>
                      {f.sources.length === 0 ? (
                        <p style={{ color: "var(--muted-foreground)" }}>No saved knowledge matched.</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {f.sources.map((s, si) => (
                            <li key={si} className="flex items-start gap-1.5" style={{ color: "var(--muted-foreground)" }}>
                              {s.source_type === "document" ? <FileText size={11} className="mt-0.5 shrink-0" /> : <Brain size={11} className="mt-0.5 shrink-0" />}
                              <span className="break-words">{s.content}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Report */}
            <article className="rounded-md border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={exportReport}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-opacity hover:opacity-80"
                  style={{ color: "var(--muted-foreground)", border: "1px solid var(--border)" }}
                  title="Export this report as Markdown"
                >
                  <Download size={13} aria-hidden="true" />
                  Export
                </button>
              </div>
              <Markdown>{result.report}</Markdown>
            </article>
          </div>
        )}

        {!result && !running && !error && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Telescope size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm font-medium">Deep research over your knowledge</p>
            <p className="text-xs max-w-md" style={{ color: "var(--muted-foreground)" }}>
              Ask a question — Lantern breaks it into sub-questions, pulls relevant
              passages from your documents and memories, and writes a structured
              report. (Index your knowledge on the Memory page first for best results.)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
