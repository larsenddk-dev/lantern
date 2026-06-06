"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Startup gate for the desktop app.
 *
 * On launch the bundled Python sidecar takes a few seconds to come up
 * (PyInstaller --onefile cold start). Until /health responds we show a small
 * splash instead of letting every page fire failing requests.
 *
 * Safety: falls through to the app after MAX_ATTEMPTS so it can never hang
 * (e.g. in the browser with no backend). A 500ms grace avoids a flash when the
 * backend is already up (normal web use).
 */
const MAX_ATTEMPTS = 30; // ~30s

export function StartupGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [showSplash, setShowSplash] = useState(false);

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

    return () => {
      cancelled = true;
      clearTimeout(grace);
    };
  }, []);

  if (ready) return <>{children}</>;
  if (!showSplash) return null;

  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-4"
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
      <p className="text-xs max-w-xs text-center" style={{ color: "var(--muted-foreground)" }}>
        Warming up the local engine. First launch takes a few seconds.
      </p>
    </div>
  );
}
