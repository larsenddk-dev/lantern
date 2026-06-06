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
  CompareTarget,
  CompareResult,
  AgentResponse,
  AgentStep,
  ResearchResponse,
  ResearchFinding,
  ResearchSource,
  SearchHit,
  EmailListResponse,
  EmailMeta,
  EmailDetail,
  EmailTriage,
  CalendarResponse,
  CalendarEvent,
  Prompt,
  CreatePromptPayload,
  UpdatePromptPayload,
  StarredMessage,
  Stats,
  CookbookStatus,
  CookbookCatalog,
  CookbookInstalledModel,
  CookbookPullEvent,
} from "./types";
import { toast } from "./toast";

const BASE_URL =
  process.env.NEXT_PUBLIC_LANTERN_API_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    // Network/connection failure (e.g. backend not running).
    toast(`Can't reach the Lantern backend (${path}).`);
    throw new Error(`Network error reaching ${path}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    toast(`Request failed (${res.status}) on ${path}`);
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

  renameSession(id: string, title: string): Promise<Session> {
    return request(`/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  },

  deleteSession(id: string): Promise<{ ok: boolean }> {
    return request(`/sessions/${id}`, { method: "DELETE" });
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
    useContext: boolean = true,
  ): Promise<void> {
    const body: Record<string, unknown> = { session_id: sessionId, message };
    if (providerId) body.provider_id = providerId;
    if (model) body.model = model;
    if (!useContext) body.use_context = false;

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

  // ---------------------------------------------------------------------------
  // Compare API helper (multi-model)
  // ---------------------------------------------------------------------------

  compare(message: string, targets: CompareTarget[]): Promise<{ results: CompareResult[] }> {
    return request("/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, targets }),
    });
  },

  // ---------------------------------------------------------------------------
  // Agent API helper (tool-calling loop)
  // ---------------------------------------------------------------------------

  runAgent(message: string, maxSteps = 5): Promise<AgentResponse> {
    return request("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, max_steps: maxSteps }),
    });
  },

  // ---------------------------------------------------------------------------
  // Deep Research API helper
  // ---------------------------------------------------------------------------

  research(question: string, maxSubquestions = 4): Promise<ResearchResponse> {
    return request("/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, max_subquestions: maxSubquestions }),
    });
  },

  // ---------------------------------------------------------------------------
  // Global search
  // ---------------------------------------------------------------------------

  search(query: string): Promise<{ results: SearchHit[] }> {
    return request(`/search?q=${encodeURIComponent(query)}`);
  },

  // ---------------------------------------------------------------------------
  // Email (read-only IMAP)
  // ---------------------------------------------------------------------------

  listEmail(): Promise<EmailListResponse> {
    return request("/email");
  },

  getEmail(uid: string): Promise<EmailDetail> {
    return request(`/email/${encodeURIComponent(uid)}`);
  },

  triageEmail(uid: string): Promise<EmailTriage> {
    return request(`/email/${encodeURIComponent(uid)}/triage`, { method: "POST" });
  },

  // ---------------------------------------------------------------------------
  // Calendar (read-only CalDAV)
  // ---------------------------------------------------------------------------

  listCalendar(days = 14): Promise<CalendarResponse> {
    return request(`/calendar?days=${days}`);
  },

  // ---------------------------------------------------------------------------
  // Prompts
  // ---------------------------------------------------------------------------

  listPrompts(): Promise<Prompt[]> {
    return request("/prompts");
  },

  createPrompt(payload: CreatePromptPayload): Promise<Prompt> {
    return request("/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  updatePrompt(id: string, payload: UpdatePromptPayload): Promise<Prompt> {
    return request(`/prompts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deletePrompt(id: string): Promise<{ ok: boolean }> {
    return request(`/prompts/${id}`, { method: "DELETE" });
  },

  // ---------------------------------------------------------------------------
  // Starred messages
  // ---------------------------------------------------------------------------

  updateMessage(id: string, content: string): Promise<Message> {
    return request(`/messages/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  },

  deleteMessage(id: string): Promise<{ ok: boolean }> {
    return request(`/messages/${id}`, { method: "DELETE" });
  },

  generateTasks(payload: {
    session_id?: string;
    text?: string;
    max_tasks?: number;
  }): Promise<{ created: Task[]; count: number }> {
    return request("/tasks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  starMessage(id: string): Promise<{ ok: boolean; starred: true }> {
    return request(`/messages/${id}/star`, { method: "POST" });
  },

  unstarMessage(id: string): Promise<{ ok: boolean; starred: false }> {
    return request(`/messages/${id}/star`, { method: "DELETE" });
  },

  listStarredMessages(): Promise<StarredMessage[]> {
    return request("/messages/starred");
  },

  // ---------------------------------------------------------------------------
  // Cookbook — local Ollama integration
  // ---------------------------------------------------------------------------

  cookbookStatus(): Promise<CookbookStatus> {
    return request("/cookbook/status");
  },

  cookbookCatalog(): Promise<CookbookCatalog> {
    return request("/cookbook/catalog");
  },

  cookbookInstalledModels(): Promise<{ models: CookbookInstalledModel[] }> {
    return request("/cookbook/models");
  },

  /**
   * Stream pull progress for a model. Calls onEvent for every Ollama event
   * (status updates, byte counters), and once with null when the stream ends.
   * Throws on transport-level errors; aborts cleanly if the AbortSignal fires.
   */
  async cookbookPull(
    model: string,
    onEvent: (event: CookbookPullEvent | null) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${BASE_URL}/cookbook/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Pull returned ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice("data: ".length);
        if (data === "[DONE]") {
          onEvent(null);
          return;
        }
        try {
          onEvent(JSON.parse(data) as CookbookPullEvent);
        } catch {
          /* skip malformed line */
        }
      }
    }
    onEvent(null);
  },

  cookbookUse(model: string, label?: string): Promise<Provider> {
    return request("/cookbook/use", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, label }),
    });
  },

  cookbookDeleteModel(model: string): Promise<{ ok: boolean }> {
    return request(`/cookbook/models/${encodeURIComponent(model)}`, {
      method: "DELETE",
    });
  },

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  stats(): Promise<Stats> {
    return request("/stats");
  },
};


export type {
  Session, SessionDetail, Message,
  Provider, CreateProviderPayload, UpdateProviderPayload,
  Note, CreateNotePayload, UpdateNotePayload,
  Task, CreateTaskPayload, UpdateTaskPayload,
  DocumentMeta, DocumentDetail,
  Memory, CreateMemoryPayload, UpdateMemoryPayload,
  CompareTarget, CompareResult,
  AgentResponse, AgentStep,
  ResearchResponse, ResearchFinding, ResearchSource,
  SearchHit,
  EmailListResponse, EmailMeta, EmailDetail, EmailTriage,
  CalendarResponse, CalendarEvent,
  Prompt, CreatePromptPayload, UpdatePromptPayload,
  StarredMessage, Stats,
  CookbookStatus, CookbookCatalog, CookbookInstalledModel, CookbookPullEvent,
};
