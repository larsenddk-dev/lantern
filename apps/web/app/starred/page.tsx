"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, MessageSquare } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { StarredMessage } from "@/lib/types";
import { Markdown } from "@/components/markdown";
import { toast } from "@/lib/toast";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function StarredPage() {
  const [items, setItems] = useState<StarredMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await api.listStarredMessages());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function unstar(id: string) {
    try {
      await api.unstarMessage(id);
      setItems((prev) => prev.filter((m) => m.id !== id));
      toast("Unstarred", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Star size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Starred</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Pinned messages across all conversations
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-3xl w-full mx-auto">
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center py-16">
            <Star size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm font-medium">No starred messages yet</p>
            <p className="text-xs max-w-xs" style={{ color: "var(--muted-foreground)" }}>
              Hover any message in a chat and click <Star size={11} className="inline" /> to save it here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((m) => (
              <li
                key={m.id}
                className="p-3 rounded-md border"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                  <Link
                    href={`/chat?focus=${encodeURIComponent(m.session_id)}`}
                    className="flex items-center gap-1 hover:underline"
                  >
                    <MessageSquare size={11} aria-hidden="true" />
                    {m.session_title || "(conversation)"}
                  </Link>
                  <span>·</span>
                  <span>{m.role === "user" ? "You" : "Lantern"}</span>
                  <span>·</span>
                  <span>{formatDate(m.created_at)}</span>
                  <button
                    type="button"
                    onClick={() => unstar(m.id)}
                    aria-label="Unstar"
                    className="ml-auto p-1 rounded hover:opacity-70"
                    style={{ color: "var(--primary)" }}
                  >
                    <Star size={12} fill="currentColor" aria-hidden="true" />
                  </button>
                </div>
                {m.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                ) : (
                  <div className="text-sm">
                    <Markdown>{m.content}</Markdown>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
