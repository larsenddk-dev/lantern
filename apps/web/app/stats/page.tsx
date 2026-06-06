"use client";

import { useState, useEffect } from "react";
import {
  BarChart3, MessageSquare, StickyNote, CheckSquare, FileText, Brain, Sparkles,
  Star, Database, Server, Download,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Stats } from "@/lib/types";

const BASE_URL =
  process.env.NEXT_PUBLIC_LANTERN_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

interface CardProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: number;
  hint?: string;
}

function StatCard({ icon: Icon, label, value, hint }: CardProps) {
  return (
    <div className="rounded-md border p-4 flex items-start gap-3" style={{ borderColor: "var(--border)" }}>
      <Icon size={18} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide" style={{ color: "var(--muted-foreground)" }}>
          {label}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
        {hint && <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{hint}</p>}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.stats().then(setStats).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <BarChart3 size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Stats</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Your workspace by the numbers
        </span>
        <a
          href={`${BASE_URL}/export/chats`}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
          title="Download every conversation as a ZIP of Markdown files"
        >
          <Download size={13} aria-hidden="true" />
          Export all chats (.zip)
        </a>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-5xl w-full mx-auto">
        {loading || !stats ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
        ) : (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <StatCard
              icon={MessageSquare} label="Conversations" value={stats.sessions}
              hint={`${stats.messages.toLocaleString()} messages total`}
            />
            <StatCard
              icon={MessageSquare} label="You / AI" value={stats.messages_user}
              hint={`${stats.messages_assistant.toLocaleString()} from the AI`}
            />
            <StatCard icon={Star} label="Starred messages" value={stats.starred_messages} />
            <StatCard icon={StickyNote} label="Notes" value={stats.notes} />
            <StatCard
              icon={CheckSquare} label="Tasks" value={stats.tasks}
              hint={`${stats.tasks_done.toLocaleString()} done`}
            />
            <StatCard icon={FileText} label="Documents" value={stats.documents} />
            <StatCard
              icon={Brain} label="Memories" value={stats.memories}
              hint={`${stats.memories_pinned.toLocaleString()} pinned`}
            />
            <StatCard icon={Sparkles} label="Saved prompts" value={stats.prompts} />
            <StatCard icon={Database} label="Indexed chunks (RAG)" value={stats.embeddings} />
            <StatCard icon={Server} label="AI providers" value={stats.providers} />
          </div>
        )}
      </div>
    </div>
  );
}
