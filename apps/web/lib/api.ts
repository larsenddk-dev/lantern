/**
 * Lantern API client — thin fetch wrapper for the FastAPI backend.
 * Base URL is read from NEXT_PUBLIC_LANTERN_API_URL (defaults to localhost:8000).
 */

import type {
  Session,
  SessionDetail,
  Message,
  Provider,
  CreateProviderPayload,
  UpdateProviderPayload,
  ActiveProviderResponse,
  Note,
  CreateNotePayload,
  UpdateNotePayload,
  Task,
  CreateTaskPayload,
  UpdateTaskPayload,
  DocumentMeta,
  DocumentDetail,
  Memory,
  CreateMemoryPayload,
  UpdateMemoryPayload,
} from "./types";

const BASE_URL =
  process.env.NEXT_PUBLIC_LANTERN_API_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health(): Promise<{ status: string }> {
    return request("/health");
  },

  createSession(title?: string): Promise<Session> {
    return request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title ?? "New conversation" }),
    });
  },

  listSessions(): Promise<Session[]> {
    return request("/sessions");
  },

  getSession(id: string): Promise<SessionDetail> {
    return request(`/sessions/${id}`);
  },

  /**
   * Stream a chat reply. Calls the callback for each delta string, and once
   * more with null when the stream ends.
   */
  async streamChat(
    sessionId: string,
    message: string,
    onDelta: (delta: string | null) => void,
    signal?: AbortSignal,
    providerId?: string,
    model?: string,
  ): Promise<void> {
    const body: Record<string, string> = { session_id: sessionId, message };
    if (providerId) body.provider_id = providerId;
    if (model) body.model = model;

    const res = await fetch(`${BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Chat stream returned ${res.status}: ${text}`);
    }
    if (!res.body) throw new Error("Response has no body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // All complete lines except the last (may be partial)
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice("data: ".length);
        if (data === "[DONE]") {
          onDelta(null);
          return;
        }
        try {
          const parsed = JSON.parse(data) as { delta?: string };
          if (parsed.delta) onDelta(parsed.delta);
        } catch {
          // malformed line — skip
        }
      }
    }
    onDelta(null);
  },

  // ---------------------------------------------------------------------------
  // Provider API helpers (Phase 2a)
  // ---------------------------------------------------------------------------

  listProviders(): Promise<Provider[]> {
    return request("/providers");
  },

  getActiveProvider(): Promise<ActiveProviderResponse> {
    return request("/providers/active");
  },

  createProvider(payload: CreateProviderPayload): Promise<Provider> {
    return request("/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  updateProvider(id: string, payload: UpdateProviderPayload): Promise<Provider> {
    return request(`/providers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deleteProvider(id: string): Promise<{ ok: boolean }> {
    return request(`/providers/${id}`, { method: "DELETE" });
  },

  activateProvider(id: string): Promise<Provider> {
    return request(`/providers/${id}/activate`, { method: "POST" });
  },

  // ---------------------------------------------------------------------------
  // Notes API helpers (Phase 2b)
  // ---------------------------------------------------------------------------

  listNotes(): Promise<Note[]> {
    return request("/notes");
  },

  getNote(id: string): Promise<Note> {
    return request(`/notes/${id}`);
  },

  createNote(payload: CreateNotePayload): Promise<Note> {
    return request("/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  updateNote(id: string, payload: UpdateNotePayload): Promise<Note> {
    return request(`/notes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deleteNote(id: string): Promise<{ ok: boolean }> {
    return request(`/notes/${id}`, { method: "DELETE" });
  },

  // ---------------------------------------------------------------------------
  // Tasks API helpers (Phase 2b)
  // ---------------------------------------------------------------------------

  listTasks(): Promise<Task[]> {
    return request("/tasks");
  },

  getTask(id: string): Promise<Task> {
    return request(`/tasks/${id}`);
  },

  createTask(payload: CreateTaskPayload): Promise<Task> {
    return request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  updateTask(id: string, payload: UpdateTaskPayload): Promise<Task> {
    return request(`/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deleteTask(id: string): Promise<{ ok: boolean }> {
    return request(`/tasks/${id}`, { method: "DELETE" });
  },

  // ---------------------------------------------------------------------------
  // Documents API helpers (Phase 2c)
  // ---------------------------------------------------------------------------

  listDocuments(): Promise<DocumentMeta[]> {
    return request("/documents");
  },

  getDocument(id: string): Promise<DocumentDetail> {
    return request(`/documents/${id}`);
  },

  uploadDocument(file: File): Promise<DocumentDetail> {
    const form = new FormData();
    form.append("file", file);
    // Note: do NOT set Content-Type — the browser adds the multipart boundary.
    return request("/documents", { method: "POST", body: form });
  },

  deleteDocument(id: string): Promise<{ ok: boolean }> {
    return request(`/documents/${id}`, { method: "DELETE" });
  },

  // ---------------------------------------------------------------------------
  // Memory API helpers
  // ---------------------------------------------------------------------------

  listMemories(): Promise<Memory[]> {
    return request("/memories");
  },

  createMemory(payload: CreateMemoryPayload): Promise<Memory> {
    return request("/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  updateMemory(id: string, payload: UpdateMemoryPayload): Promise<Memory> {
    return request(`/memories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deleteMemory(id: string): Promise<{ ok: boolean }> {
    return request(`/memories/${id}`, { method: "DELETE" });
  },

  // ---------------------------------------------------------------------------
  // RAG API helpers (embeddings + retrieval)
  // ---------------------------------------------------------------------------

  ragStatus(): Promise<{ embeddings: number }> {
    return request("/rag/status");
  },

  ragIndex(): Promise<{ indexed: number; total: number }> {
    return request("/rag/index", { method: "POST" });
  },

  ragSearch(query: string, k = 5): Promise<
    { source_type: string; source_id: string; content: string; score: number }[]
  > {
    return request("/rag/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, k }),
    });
  },
};

export type {
  Session, SessionDetail, Message,
  Provider, CreateProviderPayload, UpdateProviderPayload,
  Note, CreateNotePayload, UpdateNotePayload,
  Task, CreateTaskPayload, UpdateTaskPayload,
  DocumentMeta, DocumentDetail,
  Memory, CreateMemoryPayload, UpdateMemoryPayload,
};
