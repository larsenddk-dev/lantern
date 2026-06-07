"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

/**
 * First-run router. We send the user to /welcome when they have no provider
 * configured yet, so the very first thing they see is a guided choice — bring
 * an API key, or run a model locally — instead of an empty chat that errors on
 * the first message. Returning users (any provider exists) go straight to /chat.
 */
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    api
      .listProviders()
      .then((providers) => {
        if (cancelled) return;
        router.replace(providers.length === 0 ? "/welcome" : "/chat");
      })
      .catch(() => {
        // Backend unreachable — default to /chat which has its own empty state.
        if (!cancelled) router.replace("/chat");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
