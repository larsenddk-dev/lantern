"use client";

import { useState } from "react";
import { Bot, Send, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import type { AgentResponse } from "@/lib/types";

interface Turn {
  question: string;
  response: AgentResponse | null;
  error: string | null;
}

export default function AgentPage() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || running) return;
    setInput("");
    const idx = turns.length;
    setTurns((t) => [...t, { question, response: null, error: null }]);
    setRunning(true);
    try {
      const response = await api.runAgent(question);
      setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, response } : turn)));
      if (response.steps.length) setOpenSteps((s) => new Set(s).add(idx));
    } catch (err) {
      const error = err instanceof Error ? err.message : "Agent failed";
      setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, error } : turn)));
    } finally {
      setRunning(false);
    }
  }

  function toggleSteps(i: number) {
    setOpenSteps((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Bot size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Agent</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Uses tools: knowledge search, web search, notes, tasks, calculator
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Bot size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm font-medium">Ask the agent</p>
            <p className="text-xs max-w-sm" style={{ color: "var(--muted-foreground)" }}>
              It can search your memories &amp; documents, list your notes and tasks,
              and do arithmetic — then answer. Try &ldquo;What tasks do I have?&rdquo;
              or &ldquo;What&apos;s 18% of 240?&rdquo;
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5 max-w-2xl mx-auto">
            {turns.map((turn, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="self-end px-3 py-2 rounded-lg text-sm max-w-[85%]"
                     style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
                  {turn.question}
                </div>

                {turn.error ? (
                  <div className="px-3 py-2 rounded-md text-xs"
                       style={{ background: "var(--destructive, #fee)", color: "var(--destructive-foreground, #900)" }}>
                    {turn.error}
                  </div>
                ) : turn.response === null ? (
                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Thinking…</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {turn.response.steps.length > 0 && (
                      <div className="rounded-md border text-xs" style={{ borderColor: "var(--border)" }}>
                        <button
                          type="button"
                          onClick={() => toggleSteps(i)}
                          className="flex items-center gap-1.5 px-3 py-2 w-full text-left"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          {openSteps.has(i) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <Wrench size={12} />
                          {turn.response.steps.length} tool call{turn.response.steps.length === 1 ? "" : "s"}
                        </button>
                        {openSteps.has(i) && (
                          <div className="px-3 pb-2 flex flex-col gap-2">
                            {turn.response.steps.map((step, si) => (
                              <div key={si} className="font-mono text-[11px] leading-relaxed">
                                <span style={{ color: "var(--primary)" }}>{step.tool}</span>
                                <span style={{ color: "var(--muted-foreground)" }}>({JSON.stringify(step.args)})</span>
                                <div className="truncate" style={{ color: "var(--muted-foreground)" }}>→ {step.result}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words"
                         style={{ background: "var(--muted)", color: "var(--foreground)" }}>
                      {turn.response.reply || "(no reply)"}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={run} className="flex gap-2 p-4 shrink-0"
            style={{ borderTop: "1px solid var(--border)" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent…"
          disabled={running}
          className="flex-1 px-3 py-2 rounded-md text-sm border outline-none"
          style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
        />
        <button
          type="submit"
          disabled={running || !input.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Send size={14} aria-hidden="true" />
          {running ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
