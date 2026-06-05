"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Provider } from "@/lib/types";

interface ProviderSwitcherProps {
  /** Called when the user picks a different active provider. */
  onProviderChange?: (provider: Provider | null) => void;
}

export function ProviderSwitcher({ onProviderChange }: ProviderSwitcherProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProvider, setActiveProvider] = useState<Provider | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, activeResp] = await Promise.all([
        api.listProviders(),
        api.getActiveProvider(),
      ]);
      setProviders(list);
      setActiveProvider(activeResp.active);
    } catch {
      // backend may not be running — silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSelect(provider: Provider) {
    setOpen(false);
    try {
      const updated = await api.activateProvider(provider.id);
      setActiveProvider(updated);
      // Refresh full list to update is_active flags
      const list = await api.listProviders();
      setProviders(list);
      onProviderChange?.(updated);
    } catch {
      // silent fail — user will see stale label
    }
  }

  if (loading) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
        style={{ color: "var(--muted-foreground)" }}
      >
        <Zap size={12} />
        <span>Loading…</span>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <a
        href="/settings"
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-opacity hover:opacity-80"
        style={{
          color: "var(--muted-foreground)",
          border: "1px dashed var(--border)",
        }}
        title="Go to Settings to add a provider"
      >
        <Zap size={12} />
        <span>Add a provider</span>
      </a>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-opacity hover:opacity-80",
          open && "opacity-80"
        )}
        style={{
          border: "1px solid var(--border)",
          background: "var(--muted)",
          color: "var(--foreground)",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch provider"
      >
        <Zap size={12} style={{ color: "var(--primary)" }} aria-hidden="true" />
        <span className="max-w-[140px] truncate font-mono">
          {activeProvider ? activeProvider.model : "env default"}
        </span>
        <ChevronDown size={11} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-lg border shadow-lg py-1 min-w-[200px]"
          style={{
            background: "var(--background)",
            borderColor: "var(--border)",
          }}
          role="listbox"
          aria-label="Choose provider"
        >
          {providers.map((p) => (
            <button
              key={p.id}
              role="option"
              aria-selected={p.is_active}
              onClick={() => handleSelect(p)}
              className="w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors hover:opacity-80"
              style={{
                background: p.is_active ? "var(--accent)" : "transparent",
              }}
            >
              <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                {p.label}
                {p.is_active && (
                  <span
                    className="ml-1.5 text-[10px] font-normal px-1 rounded"
                    style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                  >
                    active
                  </span>
                )}
              </span>
              <span
                className="text-[11px] font-mono truncate"
                style={{ color: "var(--muted-foreground)" }}
              >
                {p.model}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
