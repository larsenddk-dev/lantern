"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Startup gate for the desktop app.
 *
 * On launch the Tauri shell spawns two sidecars (lantern-api + Ollama).
 * Normal launches: backend reachable in <2s — splash never appears thanks
 * to the 500ms grace.
 * First launch on macOS: Gatekeeper has to scan and verify every file in
 * the unsigned bundle (~500 MB with Ollama). That can take 30-60s and
 * isn't a Lantern bug; we just have to wait it out. At 15s in we surface
 * a reassuring "first launch is slow" note so the user doesn't think the
 * app froze.
 *
 * Safety: falls through to the app after MAX_ATTEMPTS so it never hangs
 * (e.g. running in a plain browser with no backend at all).
 */
const MAX_ATTEMPTS = 90; // ~90s — first launch on macOS Gatekeeper can be 60s+
const SLOW_HINT_AFTER = 15; // seconds before we show the "first launch" note

export function StartupGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [showSplash, setShowSplash] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      if (cancelled) return;
      try {
        await api.health();
        if (!cancelled) setReady(true);
      } catch {
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          if (!cancelled) setReady(true); // give up gating; pages show own errors
          return;
        }
        setTimeout(tick, 1000);
      }
    };
    tick();

    const grace = setTimeout(() => {
      if (!cancelled) setShowSplash(true);
    }, 500);

    const slow = setTimeout(() => {
      if (!cancelled) setShowSlowHint(true);
    }, SLOW_HINT_AFTER * 1000);

    return () => {
      cancelled = true;
      clearTimeout(grace);
      clearTimeout(slow);
    };
  }, []);

  if (ready) return <>{children}</>;
  if (!showSplash) return null;

  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-4 px-6"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <Image
        src="/lantern-logo.png"
        alt="Lantern"
        width={56}
        height={56}
        priority
        className="animate-pulse"
      />
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
        <Loader2 size={15} className="animate-spin" aria-hidden="true" />
        Starting Lantern…
      </div>
      <p
        className="text-xs max-w-xs text-center transition-opacity duration-500"
        style={{
          color: "var(--muted-foreground)",
          opacity: showSlowHint ? 1 : 0.7,
        }}
      >
        {showSlowHint
          ? "First launch can take 30-60 seconds while your OS verifies the app. Subsequent launches are instant."
          : "Warming up the local engine."}
      </p>
    </div>
  );
}
