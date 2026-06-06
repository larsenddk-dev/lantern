"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

/**
 * First-run router. We send the user to /cookbook when they have no provider
 * configured yet, so the very first thing they see is "pick a model to install"
 * instead of an empty chat screen with no working backend. Returning users
 * (any provider exists) go straight to /chat.
 */
export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    api
      .listProviders()
      .then((providers) => {
        if (cancelled) return;
        router.replace(providers.length === 0 ? "/cookbook" : "/chat");
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
