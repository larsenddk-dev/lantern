"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ExternalLink, KeyRound, Cpu, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { RECOMMENDED_PRESETS } from "@/lib/provider-presets";

/**
 * First-run onboarding / empty-state.
 *
 * Lantern is useless until the user wires up one provider, so a fresh install
 * shouldn't drop them into an empty chat that errors on the first message.
 * This screen makes the next step obvious: either bring an API key (the
 * recommended, plug-and-play path) or run a model locally via the Cookbook.
 *
 * It also self-heals: if a provider already exists (e.g. the user added one and
 * navigated back here), it congratulates them and points at chat instead of
 * nagging them to set up again.
 */
export function Onboarding() {
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listProviders()
      .then((providers) => {
        if (!cancelled) setHasProvider(providers.length > 0);
      })
      .catch(() => {
        // Backend unreachable — assume not set up so we still show guidance.
        if (!cancelled) setHasProvider(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-12">
      <div className="w-full max-w-2xl flex flex-col items-center text-center gap-6">
        <Image
          src="/lantern-logo.png"
          alt="Lantern"
          width={64}
          height={64}
          priority
        />

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--foreground)" }}>
            Welcome to Lantern
          </h1>
          <p className="text-sm max-w-md mx-auto" style={{ color: "var(--muted-foreground)" }}>
            Your own local-first AI workspace. Everything stays on your machine —
            you just bring a model. Pick one way to get started.
          </p>
        </div>

        {hasProvider && (
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm"
            style={{ borderColor: "var(--primary)", background: "var(--accent)", color: "var(--foreground)" }}
          >
            <Check size={15} style={{ color: "var(--primary)" }} aria-hidden="true" />
            You already have a provider configured.
            <Link href="/chat" className="underline font-medium" style={{ color: "var(--primary)" }}>
              Start chatting →
            </Link>
          </div>
        )}

        {/* Two paths */}
        <div className="grid sm:grid-cols-2 gap-4 w-full text-left">
          {/* Path 1 — bring your own key (recommended) */}
          <div
            className="flex flex-col gap-3 p-5 rounded-xl border"
            style={{ borderColor: "var(--primary)", background: "var(--muted)" }}
          >
            <div className="flex items-center gap-2">
              <KeyRound size={18} style={{ color: "var(--primary)" }} aria-hidden="true" />
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Use an API key
              </h2>
              <span
                className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                Recommended
              </span>
            </div>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Plug in a provider key and start in seconds. These have a free tier —
              grab a key, paste it in Settings, and you&rsquo;re live:
            </p>
            <ul className="flex flex-col gap-1.5">
              {RECOMMENDED_PRESETS.map((p) => (
                <li key={p.label} className="flex items-center justify-between gap-2">
                  <span className="text-xs" style={{ color: "var(--foreground)" }}>
                    {p.label}
                  </span>
                  {p.apiKeyUrl && (
                    <a
                      href={p.apiKeyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] underline transition-opacity hover:opacity-80"
                      style={{ color: "var(--primary)" }}
                    >
                      <ExternalLink size={10} aria-hidden="true" />
                      Get free key
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <Link
              href="/settings"
              className="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              Add a provider in Settings
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>

          {/* Path 2 — run locally */}
          <div
            className="flex flex-col gap-3 p-5 rounded-xl border"
            style={{ borderColor: "var(--border)", background: "var(--muted)" }}
          >
            <div className="flex items-center gap-2">
              <Cpu size={18} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Run a model locally
              </h2>
            </div>
            <p className="text-xs flex-1" style={{ color: "var(--muted-foreground)" }}>
              No account, no key, fully offline. The Cookbook checks your hardware
              and helps you download a model that fits, served by Ollama.
            </p>
            <Link
              href="/cookbook"
              className="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-opacity hover:opacity-80"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              Open the Cookbook
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>

        {hasProvider === null && (
          <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            Checking your setup…
          </p>
        )}
      </div>
    </div>
  );
}
