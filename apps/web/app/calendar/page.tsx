"use client";

import { useState, useEffect, useCallback } from "react";
import { CalendarDays, RefreshCw, MapPin } from "lucide-react";
import { api } from "@/lib/api";
import type { CalendarResponse, CalendarEvent } from "@/lib/types";

function dayKey(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "long", month: "short", day: "numeric",
    });
  } catch {
    return iso.slice(0, 10) || "Undated";
  }
}

function timeLabel(ev: CalendarEvent): string {
  // All-day events come back as a date (no "T"); show "All day".
  if (ev.start && !ev.start.includes("T")) return "All day";
  try {
    const t = new Date(ev.start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return t;
  } catch {
    return "";
  }
}

export default function CalendarPage() {
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.listCalendar(30));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const configured = data?.configured ?? false;
  const events = data?.events ?? [];

  // Group events by day (events are already start-sorted from the API).
  const groups: { day: string; items: CalendarEvent[] }[] = [];
  for (const ev of events) {
    const day = dayKey(ev.start);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(ev);
    else groups.push({ day, items: [ev] });
  }

  return (
    <div className="flex flex-col h-full">
      <header
        className="flex items-center gap-2 px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <CalendarDays size={18} aria-hidden="true" />
        <h1 className="text-sm font-semibold">Calendar</h1>
        <span className="text-xs ml-2" style={{ color: "var(--muted-foreground)" }}>
          Upcoming events (read-only)
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
          <CalendarDays size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
          <p className="text-sm font-medium">Connect your calendar</p>
          <p className="text-xs max-w-md" style={{ color: "var(--muted-foreground)" }}>
            Calendar is read-only over CalDAV. Add your credentials to{" "}
            <code>.env</code> and restart the backend:
          </p>
          <pre className="text-[11px] text-left rounded-md p-3 mt-1"
               style={{ background: "var(--muted)", color: "var(--foreground)" }}>
{`LANTERN_CALDAV_URL=https://caldav.icloud.com/
LANTERN_CALDAV_USER=you@example.com
LANTERN_CALDAV_PASSWORD=your-app-password`}
          </pre>
          <p className="text-[11px] max-w-md" style={{ color: "var(--muted-foreground)" }}>
            Lantern only reads upcoming events — it never creates or changes them.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto">
          {events.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              {data?.error ? `Error: ${data.error}` : "No upcoming events in the next 30 days."}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map((g) => (
                <div key={g.day}>
                  <h2 className="text-xs font-semibold mb-2 uppercase tracking-wide"
                      style={{ color: "var(--muted-foreground)" }}>
                    {g.day}
                  </h2>
                  <ul className="flex flex-col gap-1.5">
                    {g.items.map((ev, i) => (
                      <li key={i} className="flex items-start gap-3 px-3 py-2 rounded-md border"
                          style={{ borderColor: "var(--border)" }}>
                        <span className="text-xs font-mono shrink-0 w-16 pt-0.5"
                              style={{ color: "var(--muted-foreground)" }}>
                          {timeLabel(ev)}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate">{ev.summary}</span>
                          {ev.location && (
                            <span className="flex items-center gap-1 text-xs truncate"
                                  style={{ color: "var(--muted-foreground)" }}>
                              <MapPin size={11} aria-hidden="true" /> {ev.location}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
