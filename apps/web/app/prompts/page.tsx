"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Plus, Trash2, Edit2, Check, X, Copy } from "lucide-react";
import { api } from "@/lib/api";
import type { Prompt } from "@/lib/types";
import { toast } from "@/lib/toast";

interface EditorProps {
  initial?: { title: string; content: string };
  onSave: (title: string, content: string) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function PromptEditor({ initial, onSave, onCancel, saving }: EditorProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(title, content);
      }}
      className="flex flex-col gap-3"
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Prompt title"
        autoFocus
        className="px-3 py-2 rounded-md text-sm border outline-none font-medium"
        style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="The prompt text…"
        rows={8}
        className="px-3 py-2 rounded-md text-sm border outline-none resize-y font-mono"
        style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Check size={13} aria-hidden="true" />
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border"
          style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
        >
          <X size={13} aria-hidden="true" />
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  const visiblePrompts = filter.trim()
    ? prompts.filter((p) =>
        ((p.title || "") + " " + (p.content || ""))
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
      )
    : prompts;

  const load = useCallback(async () => {
    try {
      setPrompts(await api.listPrompts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(title: string, content: string) {
    setSaving(true);
    try {
      await api.createPrompt({ title, content });
      setCreating(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string, title: string, content: string) {
    setSaving(true);
    try {
      await api.updatePrompt(id, { title, content });
      setEditingId(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await api.deletePrompt(id);
    await load();
  }

  async function copyPrompt(p: Prompt) {
    try {
      await navigator.clipboard.writeText(p.content);
      toast("Prompt copied", "success");
    } catch {
      toast("Failed to copy");
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <Sparkles size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Prompts</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Saved system / user prompts you can paste anywhere
        </span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Plus size={13} aria-hidden="true" />
          New prompt
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-3xl w-full mx-auto">
        {creating && (
          <div className="mb-4 p-3 rounded-md border" style={{ borderColor: "var(--border)" }}>
            <PromptEditor
              onSave={handleCreate}
              onCancel={() => setCreating(false)}
              saving={saving}
            />
          </div>
        )}

        {!loading && prompts.length > 3 && (
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter prompts…"
            className="w-full mb-4 px-3 py-2 rounded-md text-sm border outline-none"
            style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
          />
        )}

        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
        ) : prompts.length === 0 && !creating ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center py-16">
            <Sparkles size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm font-medium">No prompts yet</p>
            <p className="text-xs max-w-xs" style={{ color: "var(--muted-foreground)" }}>
              Save reusable prompts — system instructions, templates, role plays — then
              copy them anywhere.
            </p>
          </div>
        ) : visiblePrompts.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            No prompts match &ldquo;{filter}&rdquo;.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visiblePrompts.map((p) =>
              editingId === p.id ? (
                <li key={p.id} className="p-3 rounded-md border" style={{ borderColor: "var(--border)" }}>
                  <PromptEditor
                    initial={{ title: p.title, content: p.content }}
                    onSave={(title, content) => handleUpdate(p.id, title, content)}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                </li>
              ) : (
                <li key={p.id} className="p-3 rounded-md border" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-start gap-2 mb-2">
                    <h3 className="text-sm font-semibold flex-1 truncate">{p.title || "(untitled)"}</h3>
                    <button
                      type="button"
                      onClick={() => copyPrompt(p)}
                      aria-label="Copy prompt"
                      className="p-1.5 rounded-md hover:opacity-70"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      <Copy size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(p.id)}
                      aria-label="Edit prompt"
                      className="p-1.5 rounded-md hover:opacity-70"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      <Edit2 size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      aria-label="Delete prompt"
                      className="p-1.5 rounded-md hover:opacity-70"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <pre
                    className="text-xs whitespace-pre-wrap break-words font-mono"
                    style={{ color: "var(--foreground)" }}
                  >
                    {p.content}
                  </pre>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
