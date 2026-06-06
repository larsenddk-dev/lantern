"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ANIMATION_MS = 520;

export function AppReveal({ children }: { children: React.ReactNode }) {
  const [animationKey, setAnimationKey] = useState(0);
  const wasHidden = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replay = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setAnimationKey((key) => key + 1);
    timer.current = setTimeout(() => {
      timer.current = null;
    }, ANIMATION_MS);
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHidden.current = true;
      } else if (wasHidden.current) {
        wasHidden.current = false;
        replay();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [replay]);

  return (
    <div key={animationKey} className="app-reveal h-full">
      {children}
    </div>
  );
}
