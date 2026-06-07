"use client";

import { useEffect, useRef } from "react";

/**
 * Replays the subtle "reveal" animation when the user returns to the window
 * (e.g. after alt-tabbing away on the desktop app).
 *
 * Important: we restart the CSS animation by toggling the class with a forced
 * reflow — NOT by changing a React `key`. Keying this wrapper would remount the
 * entire app subtree on every refocus, throwing away component state (open chat,
 * Canvas, composer text, scroll) and refetching all data. The animation is
 * cosmetic; the mounted tree must survive a refocus.
 */
export function AppReveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const wasHidden = useRef(false);

  useEffect(() => {
    const replay = () => {
      const el = ref.current;
      if (!el) return;
      el.classList.remove("app-reveal");
      // Force a reflow so removing + re-adding the class restarts the animation.
      void el.offsetWidth;
      el.classList.add("app-reveal");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHidden.current = true;
      } else if (wasHidden.current) {
        wasHidden.current = false;
        replay();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return (
    <div ref={ref} className="app-reveal h-full">
      {children}
    </div>
  );
}
