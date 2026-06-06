"use client";

import { useState, useEffect, useCallback } from "react";
import { Mail, X, Sparkles, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { EmailMeta, EmailDetail, EmailListResponse } from "@/lib/types";

export default function EmailPage() {
  const [list, setList] = useState<EmailListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmailDetail | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await api.listEmail());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load email");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function open(uid: string) {
    setSummary(null);
    try {
      setSelected(await api.getEmail(uid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open email");
    }
  }

  async function summarize(uid: string) {
    setSummarizing(true);
    try {
      const r = await api.triageEmail(uid);
      setSummary(r.summary ?? r.error ?? r.note ?? "No summary.");
    } catch (e) {
      setSummary(e instanceof Error ? e.message : "Summary failed");
    } finally {
      setSummarizing(false);
    }
  }

  const configured = list?.configured ?? false;
  const emails: EmailMeta[] = list?.emails ?? [];

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Mail size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Email</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Read-only inbox with AI triage
        </span>
        {configured && (
          <button
            type="button"
            onClick={load}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-opacity hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            <RefreshCw size={13} aria-hidden="true" className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        )}
      </header>

      {error && (
        <div className="mx-6 mt-4 px-3 py-2 rounded-md text-xs"
             style={{ background: "var(--destructive, #fee)", color: "var(--destructive-foreground, #900)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="p-6 text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
      ) : !configured ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-8">
          <Mail size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
          <p className="text-sm font-medium">Connect your inbox</p>
          <p className="text-xs max-w-md" style={{ color: "var(--muted-foreground)" }}>
            Email is read-only and connects over IMAP. Add your credentials to{" "}
            <code>.env</code> and restart the backend:
          </p>
          <pre className="text-[11px] text-left rounded-md p-3 mt-1"
               style={{ background: "var(--muted)", color: "var(--foreground)" }}>
{`LANTERN_IMAP_HOST=imap.gmail.com
LANTERN_IMAP_USER=you@example.com
LANTERN_IMAP_PASSWORD=your-app-password`}
          </pre>
          <p className="text-[11px] max-w-md" style={{ color: "var(--muted-foreground)" }}>
            Tip: for Gmail/Outlook use an app-specific password. Lantern only reads —
            it never sends or modifies your mailbox.
          </p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6">
            {emails.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                {list?.error ? `Error: ${list.error}` : "Inbox is empty."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {emails.map((m) => (
                  <li key={m.uid}>
                    <button
                      type="button"
                      onClick={() => open(m.uid)}
                      className="flex flex-col w-full text-left px-3 py-2.5 rounded-md border min-w-0"
                      style={{
                        borderColor: "var(--border)",
                        background: selected?.uid === m.uid ? "var(--muted)" : "transparent",
                      }}
                    >
                      <span className="text-sm font-medium truncate">{m.subject}</span>
                      <span className="text-xs truncate" style={{ color: "var(--muted-foreground)" }}>
                        {m.from} · {m.date}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <aside className="w-1/2 max-w-2xl overflow-y-auto p-6 shrink-0"
                   style={{ borderLeft: "1px solid var(--border)" }}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold truncate">{selected.subject}</h2>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>
                    {selected.from} · {selected.date}
                  </p>
                </div>
                <button type="button" onClick={() => { setSelected(null); setSummary(null); }}
                        aria-label="Close" className="p-1.5 rounded-md hover:opacity-70"
                        style={{ color: "var(--muted-foreground)" }}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              {selected.uid && (
                <button
                  type="button"
                  onClick={() => summarize(selected.uid!)}
                  disabled={summarizing}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 mb-3 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  {summarizing ? "Summarizing…" : "Summarize (AI)"}
                </button>
              )}

              {summary && (
                <div className="text-xs rounded-md p-3 mb-3 whitespace-pre-wrap"
                     style={{ background: "var(--muted)", color: "var(--foreground)" }}>
                  {summary}
                </div>
              )}

              {selected.error ? (
                <p className="text-xs" style={{ color: "var(--destructive-foreground, #900)" }}>
                  {selected.error}
                </p>
              ) : (
                <pre className="text-xs whitespace-pre-wrap break-words font-sans leading-relaxed"
                     style={{ color: "var(--foreground)" }}>
                  {selected.body || "(empty)"}
                </pre>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
