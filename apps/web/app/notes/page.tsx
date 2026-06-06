"use client";

import { useState, useEffect, useCallback } from "react";
import { StickyNote, Plus, Trash2, Edit2, Check, X, Brain, Download } from "lucide-react";
import { toast } from "@/lib/toast";
import { downloadText, slugify } from "@/lib/export";
import { api } from "@/lib/api";
import type { Note } from "@/lib/types";

// ---------------------------------------------------------------------------
// NoteEditor — inline create/edit form
// ---------------------------------------------------------------------------

interface NoteEditorProps {
  initial?: { title: string; content: string };
  onSave: (title: string, content: string) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function NoteEditor({ initial, onSave, onCancel, saving }: NoteEditorProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave(title, content);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title"
        autoFocus
        className="px-3 py-2 rounded-md text-sm border outline-none font-medium"
        style={{
          borderColor: "var(--border)",
          background: "var(--muted)",
          color: "var(--foreground)",
        }}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your note…"
        rows={5}
        className="px-3 py-2 rounded-md text-sm border outline-none resize-y"
        style={{
          borderColor: "var(--border)",
          background: "var(--muted)",
          color: "var(--foreground)",
        }}
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Check size={13} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
        >
          <X size={13} />
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// NoteCard — displays a single note with edit/delete actions
// ---------------------------------------------------------------------------

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (id: string) => Promise<void>;
}

function NoteCard({ note, onEdit, onDelete }: NoteCardProps) {
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${note.title || "Untitled note"}"?`)) return;
    setBusy(true);
    try {
      await onDelete(note.id);
    } finally {
      setBusy(false);
    }
  }

  async function saveAsMemory() {
    setBusy(true);
    try {
      const text = [note.title, note.content].filter(Boolean).join(" — ");
      await api.createMemory({ content: text || "(empty)" });
      toast("Saved as memory", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function exportNote() {
    const title = note.title || "Untitled note";
    const md = `# ${title}\n\n${note.content || ""}\n`;
    downloadText(`${slugify(title)}.md`, md);
  }

  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--muted)" }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
            {note.title || <span style={{ color: "var(--muted-foreground)" }}>Untitled</span>}
          </p>
          {note.content && (
            <p
              className="text-sm mt-1 whitespace-pre-wrap break-words"
              style={{ color: "var(--muted-foreground)" }}
            >
              {note.content}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={exportNote}
            disabled={busy}
            className="p-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ color: "var(--muted-foreground)" }}
            title="Download as Markdown"
          >
            <Download size={13} />
          </button>
          <button
            onClick={saveAsMemory}
            disabled={busy}
            className="p-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ color: "var(--muted-foreground)" }}
            title="Save as memory"
          >
            <Brain size={13} />
          </button>
          <button
            onClick={() => onEdit(note)}
            disabled={busy}
            className="p-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ color: "var(--muted-foreground)" }}
            title="Edit note"
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="p-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ color: "var(--muted-foreground)" }}
            title="Delete note"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
        {new Date(note.updated_at).toLocaleString()}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotesPage — main page
// ---------------------------------------------------------------------------

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  const visibleNotes = filter.trim()
    ? notes.filter((n) =>
        ((n.title || "") + " " + (n.content || ""))
          .toLowerCase()
          .includes(filter.trim().toLowerCase()),
      )
    : notes;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listNotes();
      setNotes(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notes");
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
      await api.createNote({ title, content });
      setShowAddForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create note");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(title: string, content: string) {
    if (!editingNote) return;
    setSaving(true);
    try {
      await api.updateNote(editingNote.id, { title, content });
      setEditingNote(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update note");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteNote(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete note");
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header
        className="px-8 py-5 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <StickyNote size={20} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>
                Notes
              </h1>
              <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                Capture and organize your thoughts and ideas.
              </p>
            </div>
          </div>
          {!showAddForm && !editingNote && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium shrink-0 transition-opacity hover:opacity-80"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              <Plus size={13} />
              New note
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 px-8 py-6 max-w-2xl flex flex-col gap-4">
        {error && (
          <div
            className="px-3 py-2 rounded-md text-xs"
            style={{
              background: "var(--muted)",
              color: "var(--muted-foreground)",
              border: "1px solid var(--border)",
            }}
          >
            {error}
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <div
            className="p-4 rounded-lg border"
            style={{ borderColor: "var(--border)", background: "var(--muted)" }}
          >
            <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
              New note
            </p>
            <NoteEditor
              onSave={handleCreate}
              onCancel={() => setShowAddForm(false)}
              saving={saving}
            />
          </div>
        )}

        {/* Edit form */}
        {editingNote && (
          <div
            className="p-4 rounded-lg border"
            style={{ borderColor: "var(--border)", background: "var(--muted)" }}
          >
            <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
              Edit note
            </p>
            <NoteEditor
              initial={{ title: editingNote.title, content: editingNote.content }}
              onSave={handleUpdate}
              onCancel={() => setEditingNote(null)}
              saving={saving}
            />
          </div>
        )}

        {/* Filter bar */}
        {notes.length > 3 && (
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter notes…"
            className="w-full mb-3 px-3 py-2 rounded-md text-sm border outline-none"
            style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
          />
        )}

        {/* Note list */}
        {loading ? (
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Loading…
          </p>
        ) : notes.length === 0 && !showAddForm ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <StickyNote size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              No notes yet. Click &ldquo;New note&rdquo; to get started.
            </p>
          </div>
        ) : visibleNotes.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            No notes match &ldquo;{filter}&rdquo;.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onEdit={(n) => {
                  setEditingNote(n);
                  setShowAddForm(false);
                }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
