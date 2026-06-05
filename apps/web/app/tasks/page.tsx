"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckSquare, Plus, Trash2, Square, CheckSquare2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Task } from "@/lib/types";

// ---------------------------------------------------------------------------
// TaskRow — single task with toggle + delete
// ---------------------------------------------------------------------------

interface TaskRowProps {
  task: Task;
  onToggle: (id: string, done: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function TaskRow({ task, onToggle, onDelete }: TaskRowProps) {
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    setBusy(true);
    try {
      await onToggle(task.id, !task.done);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete task "${task.title}"?`)) return;
    setBusy(true);
    try {
      await onDelete(task.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors"
      style={{
        borderColor: "var(--border)",
        background: "var(--muted)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {/* Toggle checkbox button */}
      <button
        onClick={handleToggle}
        disabled={busy}
        className="shrink-0 transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{ color: task.done ? "var(--primary)" : "var(--muted-foreground)" }}
        title={task.done ? "Mark undone" : "Mark done"}
      >
        {task.done ? <CheckSquare2 size={18} /> : <Square size={18} />}
      </button>

      {/* Title */}
      <p
        className="flex-1 text-sm"
        style={{
          color: task.done ? "var(--muted-foreground)" : "var(--foreground)",
          textDecoration: task.done ? "line-through" : "none",
        }}
      >
        {task.title}
      </p>

      {/* Delete */}
      <button
        onClick={handleDelete}
        disabled={busy}
        className="shrink-0 p-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
        style={{ color: "var(--muted-foreground)" }}
        title="Delete task"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TasksPage — main page
// ---------------------------------------------------------------------------

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listTasks();
      setTasks(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      await api.createTask({ title });
      setNewTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(id: string, done: boolean) {
    try {
      await api.updateTask(id, { done });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update task");
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteTask(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete task");
    }
  }

  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header
        className="px-8 py-5 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <CheckSquare size={20} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>
              Tasks
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Track what needs to be done.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-8 py-6 max-w-2xl flex flex-col gap-5">
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

        {/* Add task inline form */}
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 px-3 py-2 rounded-md text-sm border outline-none"
            style={{
              borderColor: "var(--border)",
              background: "var(--muted)",
              color: "var(--foreground)",
            }}
          />
          <button
            type="submit"
            disabled={adding || !newTitle.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-40 shrink-0"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <Plus size={13} />
            {adding ? "Adding…" : "Add"}
          </button>
        </form>

        {/* Task list */}
        {loading ? (
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Loading…
          </p>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <CheckSquare size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              No tasks yet. Add one above to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Pending tasks */}
            {pending.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                  TO DO — {pending.length}
                </p>
                {pending.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}

            {/* Completed tasks */}
            {done.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                  DONE — {done.length}
                </p>
                {done.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
