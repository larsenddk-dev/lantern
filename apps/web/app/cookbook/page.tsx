"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ChefHat,
  Cpu,
  HardDrive,
  Sparkles,
  Download,
  Trash2,
  Check,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type {
  CookbookStatus,
  CookbookCatalog,
  CookbookModel,
  CookbookInstalledModel,
  CookbookPullEvent,
  CookbookFit,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatGb(gb: number): string {
  return gb < 1 ? `${(gb * 1024).toFixed(0)} MB` : `${gb.toFixed(1)} GB`;
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function fitBadge(fit: CookbookFit): { label: string; color: string } {
  switch (fit) {
    case "recommended":
      return { label: "Recommended", color: "var(--primary)" };
    case "ok":
      return { label: "Will run", color: "var(--foreground)" };
    case "tight":
      return { label: "Tight fit", color: "#b58400" };
    case "too_big":
      return { label: "Too big", color: "var(--muted-foreground)" };
    default:
      return { label: "Unknown", color: "var(--muted-foreground)" };
  }
}

// ---------------------------------------------------------------------------
// PullProgress — overlay tracking one in-flight model download.
// ---------------------------------------------------------------------------

interface PullState {
  status: string;
  completed: number;
  total: number;
  // Sample of (timestamp, bytes) used to compute a smoothed speed without
  // flicker. We keep the last ~5 samples so a momentary lull doesn't drop
  // the displayed MB/s to zero.
  samples: { t: number; b: number }[];
}

function formatMbps(bytesPerSec: number): string {
  if (bytesPerSec < 100 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s left`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m left`;
}

function PullProgress({ state, modelId }: { state: PullState; modelId: string }) {
  const pct =
    state.total > 0 ? Math.min(100, (state.completed / state.total) * 100) : 0;

  // Speed from the oldest vs newest sample in the window — smooths short
  // hiccups without going stale during a long lull.
  let speed = 0;
  let eta = Infinity;
  if (state.samples.length >= 2) {
    const first = state.samples[0];
    const last = state.samples[state.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    const db = last.b - first.b;
    if (dt > 0 && db > 0) {
      speed = db / dt;
      const remaining = Math.max(0, state.total - state.completed);
      eta = remaining / speed;
    }
  }

  return (
    <div className="flex flex-col gap-1 mt-2">
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--border)" }}
      >
        <div
          className="h-full transition-[width] duration-200"
          style={{ width: `${pct}%`, background: "var(--primary)" }}
        />
      </div>
      <p className="text-[11px] flex items-center gap-1.5 flex-wrap"
         style={{ color: "var(--muted-foreground)" }}>
        <span>{state.status}</span>
        {state.total > 0 && (
          <>
            <span>·</span>
            <span>{formatBytes(state.completed)} / {formatBytes(state.total)}</span>
          </>
        )}
        {speed > 0 && (
          <>
            <span>·</span>
            <span>{formatMbps(speed)}</span>
            <span>·</span>
            <span>{formatEta(eta)}</span>
          </>
        )}
        {modelId && state.completed === 0 && <span>· starting…</span>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelCard — a row in the catalog list.
// ---------------------------------------------------------------------------

interface ModelCardProps {
  model: CookbookModel;
  installed: boolean;
  active: boolean;
  pulling: PullState | null;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  onActivate: (id: string) => void;
}

function ModelCard({
  model,
  installed,
  active,
  pulling,
  onInstall,
  onUninstall,
  onActivate,
}: ModelCardProps) {
  const badge = fitBadge(model.fit);
  const isPulling = !!pulling;
  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-lg border"
      style={{ borderColor: "var(--border)", background: "var(--muted)" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate">{model.name}</h3>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide font-medium"
              style={{ color: badge.color, border: `1px solid ${badge.color}` }}
              title={`Your RAM: heuristic fit for "${model.fit}"`}
            >
              {badge.label}
            </span>
            {active && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1"
                style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
              >
                <Check size={10} aria-hidden="true" /> Active
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--muted-foreground)" }}>
            {model.description}
          </p>
          <p className="text-[11px] mt-2 flex items-center gap-3 flex-wrap"
             style={{ color: "var(--muted-foreground)" }}>
            <span title="Download size of the default quantization">
              {formatGb(model.size_gb)}
            </span>
            <span title="Recommended RAM for comfortable use">
              ≥ {model.recommended_ram_gb} GB RAM
            </span>
            <span className="flex gap-1">
              {model.tags.map((t) => (
                <span key={t} className="px-1 rounded"
                      style={{ background: "var(--background)" }}>{t}</span>
              ))}
            </span>
          </p>
        </div>
        <div className="shrink-0 flex flex-col gap-1.5 items-end">
          {installed ? (
            <>
              {!active && (
                <button
                  onClick={() => onActivate(model.id)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                >
                  Use in chat
                </button>
              )}
              <button
                onClick={() => onUninstall(model.id)}
                disabled={isPulling}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
                title="Uninstall this model"
              >
                <Trash2 size={12} aria-hidden="true" />
                Remove
              </button>
            </>
          ) : isPulling ? (
            <span className="flex items-center gap-1 px-3 py-1.5 text-xs"
                  style={{ color: "var(--muted-foreground)" }}>
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              Installing…
            </span>
          ) : model.fit === "too_big" ? (
            <button
              onClick={() => onInstall(model.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-opacity hover:opacity-80"
              style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
              title="This model is bigger than your RAM. It will likely thrash. Install anyway?"
            >
              <AlertTriangle size={12} aria-hidden="true" />
              Install anyway
            </button>
          ) : (
            <button
              onClick={() => onInstall(model.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              <Download size={12} aria-hidden="true" />
              Install
            </button>
          )}
        </div>
      </div>
      {pulling && <PullProgress state={pulling} modelId={model.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CookbookPage — main screen
// ---------------------------------------------------------------------------

export default function CookbookPage() {
  const router = useRouter();
  const [status, setStatus] = useState<CookbookStatus | null>(null);
  const [catalog, setCatalog] = useState<CookbookCatalog | null>(null);
  const [installed, setInstalled] = useState<CookbookInstalledModel[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Quietly hide the "Ollama isn't running" panel for ~15s after mount —
  // gives the bundled Ollama time to finish booting before we cry wolf.
  const [waitingForOllama, setWaitingForOllama] = useState(true);
  const [pulls, setPulls] = useState<Record<string, PullState>>({});
  const abortsRef = useRef<Record<string, AbortController>>({});

  const refresh = useCallback(async () => {
    const [s, c, installedRes, active] = await Promise.all([
      api.cookbookStatus().catch((): CookbookStatus => ({ running: false, error: "unreachable" })),
      api.cookbookCatalog().catch(() => null),
      api.cookbookInstalledModels().catch(() => ({ models: [] })),
      api.getActiveProvider().catch(() => ({ active: null })),
    ]);
    setStatus(s);
    if (c) setCatalog(c);
    setInstalled(installedRes.models);
    // The provider model is what we mark "Active" — strip the optional "Local · "
    // label-only difference and compare on the model id.
    setActiveModel(active.active?.model ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // While Ollama is still booting (typically <1s but up to ~10s on first
  // launch), /cookbook/status returns running:false. Poll quietly for ~15s
  // before resigning to "Ollama isn't running", so the user doesn't see a
  // spurious "Install Ollama" panel on a perfectly healthy app.
  useEffect(() => {
    if (loading || status?.running) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWaitingForOllama(false);
      return;
    }
    let attempts = 0;
    const t = setInterval(async () => {
      attempts += 1;
      try {
        const s = await api.cookbookStatus();
        if (s.running) {
          setStatus(s);
          setWaitingForOllama(false);
          refresh();
          clearInterval(t);
          return;
        }
      } catch {
        /* keep trying silently */
      }
      if (attempts >= 15) {
        // Stop pretending — show the "not running" panel so user can act.
        setWaitingForOllama(false);
        clearInterval(t);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [loading, status?.running, refresh]);

  // Re-poll the installed list while at least one pull is in flight, so the
  // "Use in chat" button shows up as soon as the model lands.
  useEffect(() => {
    if (Object.keys(pulls).length === 0) return;
    const t = setInterval(() => {
      api.cookbookInstalledModels()
        .then((r) => setInstalled(r.models))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [pulls]);

  const installedNames = new Set(installed.map((m) => m.name));

  async function handleInstall(modelId: string) {
    if (pulls[modelId]) return;
    setPulls((prev) => ({
      ...prev,
      [modelId]: { status: "starting", completed: 0, total: 0, samples: [] },
    }));
    const controller = new AbortController();
    abortsRef.current[modelId] = controller;
    try {
      await api.cookbookPull(
        modelId,
        (ev) => {
          if (ev === null) return;
          if (ev.error) {
            toast(`Install failed: ${ev.error}`);
            return;
          }
          setPulls((prev) => {
            const prior = prev[modelId];
            const now = Date.now();
            const completed = ev.completed ?? prior?.completed ?? 0;
            const total = ev.total ?? prior?.total ?? 0;
            // Keep up to 5 samples covering the last ~10s for the MB/s
            // estimate. Sample once per second to avoid render-cost churn.
            const samples = prior?.samples ?? [];
            const last = samples[samples.length - 1];
            const newSamples =
              !last || now - last.t >= 1000
                ? [...samples, { t: now, b: completed }].slice(-5)
                : samples;
            return {
              ...prev,
              [modelId]: { status: ev.status, completed, total, samples: newSamples },
            };
          });
        },
        controller.signal,
      );
      toast(`${modelId} installed`, "success");
      await refresh();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast(e instanceof Error ? e.message : "Install failed");
      }
    } finally {
      setPulls((prev) => {
        const { [modelId]: _drop, ...rest } = prev;
        return rest;
      });
      delete abortsRef.current[modelId];
    }
  }

  async function handleUninstall(modelId: string) {
    if (!confirm(`Remove ${modelId} from your machine?`)) return;
    try {
      await api.cookbookDeleteModel(modelId);
      toast(`${modelId} removed`, "success");
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Uninstall failed");
    }
  }

  async function handleActivate(modelId: string) {
    try {
      await api.cookbookUse(modelId);
      setActiveModel(modelId);
      toast(`${modelId} is now your active provider`, "success");
      router.push("/chat");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to activate");
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header className="px-8 py-5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <ChefHat size={20} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
          <div>
            <h1 className="text-xl font-semibold">Cookbook</h1>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Local AI models you can run on this machine, served by Ollama.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-8 py-6 max-w-3xl flex flex-col gap-6">
        {/* Status + hardware strip */}
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
        ) : !status?.running && waitingForOllama ? (
          <div
            className="p-4 rounded-lg border flex items-center gap-3"
            style={{ borderColor: "var(--border)", background: "var(--muted)" }}
          >
            <Loader2 size={16} className="animate-spin" style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              Starting the local engine…
            </p>
          </div>
        ) : !status?.running ? (
          <div className="p-4 rounded-lg border flex flex-col gap-3"
               style={{ borderColor: "var(--border)", background: "var(--muted)" }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: "#b58400" }} aria-hidden="true" />
              <p className="text-sm font-medium">Ollama isn&rsquo;t running</p>
            </div>
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Lantern runs models through a local Ollama server. Install it once and Lantern
              will detect it automatically.
            </p>
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
              className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              <ExternalLink size={12} aria-hidden="true" />
              Download Ollama
            </a>
            <button
              onClick={refresh}
              className="self-start text-xs underline"
              style={{ color: "var(--muted-foreground)" }}
            >
              I&rsquo;ve installed it — check again
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-md border flex items-center gap-3"
                 style={{ borderColor: "var(--border)" }}>
              <Cpu size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>CPU</p>
                <p className="text-xs truncate">{catalog?.hardware.cpu || "—"}</p>
              </div>
            </div>
            <div className="p-3 rounded-md border flex items-center gap-3"
                 style={{ borderColor: "var(--border)" }}>
              <HardDrive size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>RAM</p>
                <p className="text-xs">{catalog?.hardware.ram_gb ?? "?"} GB</p>
              </div>
            </div>
            <div className="p-3 rounded-md border flex items-center gap-3"
                 style={{ borderColor: "var(--border)" }}>
              <Sparkles size={16} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>GPU</p>
                <p className="text-xs truncate">{catalog?.hardware.gpu ?? "None detected"}</p>
              </div>
            </div>
          </div>
        )}

        {/* Catalog */}
        {catalog && status?.running && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">
              Models{" "}
              <span className="text-xs font-normal" style={{ color: "var(--muted-foreground)" }}>
                · sorted by fit for your hardware
              </span>
            </h2>
            <div className="flex flex-col gap-3">
              {[...catalog.models]
                .sort((a, b) => {
                  const order: CookbookFit[] = ["recommended", "ok", "tight", "unknown", "too_big"];
                  return order.indexOf(a.fit) - order.indexOf(b.fit);
                })
                .map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    installed={installedNames.has(m.id)}
                    active={activeModel === m.id}
                    pulling={pulls[m.id] ?? null}
                    onInstall={handleInstall}
                    onUninstall={handleUninstall}
                    onActivate={handleActivate}
                  />
                ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
