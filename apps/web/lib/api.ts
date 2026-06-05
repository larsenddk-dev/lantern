/**
 * Lantern API client — thin fetch wrapper for the FastAPI backend.
 * Base URL is read from NEXT_PUBLIC_LANTERN_API_URL (defaults to localhost:8000).
 */

import type { Session, SessionDetail, Message } from "./types";

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
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch(`${BASE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
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
};

export type { Session, SessionDetail, Message };
