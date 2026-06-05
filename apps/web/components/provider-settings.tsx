"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Edit2, Check, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Provider, CreateProviderPayload } from "@/lib/types";

// ---------------------------------------------------------------------------
// Pre-filled provider presets to make onboarding easy
// ---------------------------------------------------------------------------

const PRESETS = [
  {
    label: "OpenRouter (free)",
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    label: "Google Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
  {
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  {
    label: "Mistral",
    base_url: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
  },
  {
    label: "Cerebras",
    base_url: "https://api.cerebras.ai/v1",
    model: "llama-4-scout-17b-16e-instruct",
  },
  {
    label: "Ollama (local)",
    base_url: "http://localhost:11434/v1",
    model: "llama3.2",
  },
];

// ---------------------------------------------------------------------------
// Empty form state
// ---------------------------------------------------------------------------

const EMPTY_FORM: CreateProviderPayload = {
  label: "",
  base_url: "",
  model: "",
  api_key: "",
};

// ---------------------------------------------------------------------------
// ProviderForm — shared add/edit form
// ---------------------------------------------------------------------------

interface ProviderFormProps {
  initial?: Partial<CreateProviderPayload>;
  onSave: (payload: CreateProviderPayload) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

function ProviderForm({ initial, onSave, onCancel, saving }: ProviderFormProps) {
  const [form, setForm] = useState<CreateProviderPayload>({
    ...EMPTY_FORM,
    ...initial,
  });

  function set(field: keyof CreateProviderPayload, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function applyPreset(preset: (typeof PRESETS)[0]) {
    setForm((f) => ({
      ...f,
      label: preset.label,
      base_url: preset.base_url,
      model: preset.model,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim() || !form.base_url.trim() || !form.model.trim()) return;
    await onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Presets */}
      <div>
        <p className="text-xs mb-1.5" style={{ color: "var(--muted-foreground)" }}>
          Quick-fill a provider:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className="px-2 py-1 rounded text-xs border transition-opacity hover:opacity-80"
              style={{
                borderColor: "var(--border)",
                background: "var(--muted)",
                color: "var(--muted-foreground)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
          Label *
        </span>
        <input
          type="text"
          value={form.label}
          onChange={(e) => set("label", e.target.value)}
          placeholder="e.g. My OpenRouter"
          required
          className="px-3 py-1.5 rounded-md text-sm border outline-none"
          style={{
            borderColor: "var(--border)",
            background: "var(--muted)",
            color: "var(--foreground)",
          }}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
          Base URL *
        </span>
        <input
          type="url"
          value={form.base_url}
          onChange={(e) => set("base_url", e.target.value)}
          placeholder="https://openrouter.ai/api/v1"
          required
          className="px-3 py-1.5 rounded-md text-sm border outline-none font-mono"
          style={{
            borderColor: "var(--border)",
            background: "var(--muted)",
            color: "var(--foreground)",
          }}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
          Model *
        </span>
        <input
          type="text"
          value={form.model}
          onChange={(e) => set("model", e.target.value)}
          placeholder="openai/gpt-4o-mini"
          required
          className="px-3 py-1.5 rounded-md text-sm border outline-none font-mono"
          style={{
            borderColor: "var(--border)",
            background: "var(--muted)",
            color: "var(--foreground)",
          }}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
          API Key{" "}
          <span className="font-normal">(stored securely server-side; leave blank for Ollama)</span>
        </span>
        <input
          type="password"
          value={form.api_key}
          onChange={(e) => set("api_key", e.target.value)}
          placeholder="sk-..."
          autoComplete="new-password"
          className="px-3 py-1.5 rounded-md text-sm border outline-none font-mono"
          style={{
            borderColor: "var(--border)",
            background: "var(--muted)",
            color: "var(--foreground)",
          }}
        />
      </label>

      <div className="flex gap-2 mt-1">
        <button
          type="submit"
          disabled={saving || !form.label.trim() || !form.base_url.trim() || !form.model.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Check size={13} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-opacity hover:opacity-80"
          style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
        >
          <X size={13} />
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// ProviderRow — single provider in the list
// ---------------------------------------------------------------------------

interface ProviderRowProps {
  provider: Provider;
  onActivate: (id: string) => Promise<void>;
  onEdit: (provider: Provider) => void;
  onDelete: (id: string) => Promise<void>;
}

function ProviderRow({ provider, onActivate, onEdit, onDelete }: ProviderRowProps) {
  const [busy, setBusy] = useState(false);

  async function handleActivate() {
    setBusy(true);
    try { await onActivate(provider.id); } finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${provider.label}"?`)) return;
    setBusy(true);
    try { await onDelete(provider.id); } finally { setBusy(false); }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
        provider.is_active && "border-opacity-100"
      )}
      style={{
        borderColor: provider.is_active ? "var(--primary)" : "var(--border)",
        background: provider.is_active ? "var(--accent)" : "var(--muted)",
      }}
    >
      {/* Active indicator */}
      <div
        className="shrink-0 w-2 h-2 rounded-full"
        style={{ background: provider.is_active ? "var(--primary)" : "var(--border)" }}
        title={provider.is_active ? "Active" : "Inactive"}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
          {provider.label}
        </p>
        <p className="text-xs truncate font-mono" style={{ color: "var(--muted-foreground)" }}>
          {provider.model}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {!provider.is_active && (
          <button
            onClick={handleActivate}
            disabled={busy}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            title="Set as active provider"
          >
            <Zap size={11} />
            Use
          </button>
        )}
        {provider.is_active && (
          <span
            className="px-2 py-1 rounded text-xs font-medium"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            Active
          </span>
        )}
        <button
          onClick={() => onEdit(provider)}
          disabled={busy}
          className="p-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ color: "var(--muted-foreground)" }}
          title="Edit"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          className="p-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ color: "var(--muted-foreground)" }}
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProviderSettings — main exported component
// ---------------------------------------------------------------------------

export function ProviderSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listProviders();
      setProviders(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(payload: CreateProviderPayload) {
    setSaving(true);
    try {
      await api.createProvider(payload);
      setShowAddForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create provider");
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(payload: CreateProviderPayload) {
    if (!editingProvider) return;
    setSaving(true);
    try {
      // Only send api_key if the user typed a new one (non-empty)
      const update: Record<string, string> = {
        label: payload.label,
        base_url: payload.base_url,
        model: payload.model,
      };
      if (payload.api_key) update.api_key = payload.api_key;
      await api.updateProvider(editingProvider.id, update);
      setEditingProvider(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update provider");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: string) {
    try {
      await api.activateProvider(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to activate provider");
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteProvider(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete provider");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            AI Providers
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Add any OpenAI-compatible provider (OpenRouter, Gemini, Groq, Ollama…).
            Keys are stored securely on the server and never shown in full.
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => { setShowAddForm(true); setEditingProvider(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium shrink-0 transition-opacity hover:opacity-80"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <Plus size={13} />
            Add provider
          </button>
        )}
      </div>

      {error && (
        <div
          className="px-3 py-2 rounded-md text-xs"
          style={{
            background: "var(--muted)",
            color: "var(--muted-foreground)",
            border: "1px solid var(--border)",
          }}
        >
          {error}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div
          className="p-4 rounded-lg border"
          style={{ borderColor: "var(--border)", background: "var(--muted)" }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
            Add provider
          </p>
          <ProviderForm
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
            saving={saving}
          />
        </div>
      )}

      {/* Edit form (inline) */}
      {editingProvider && (
        <div
          className="p-4 rounded-lg border"
          style={{ borderColor: "var(--border)", background: "var(--muted)" }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
            Edit &ldquo;{editingProvider.label}&rdquo;
          </p>
          <ProviderForm
            initial={{
              label: editingProvider.label,
              base_url: editingProvider.base_url,
              model: editingProvider.model,
              api_key: "",
            }}
            onSave={handleEdit}
            onCancel={() => setEditingProvider(null)}
            saving={saving}
          />
        </div>
      )}

      {/* Provider list */}
      {loading ? (
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      ) : providers.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
          No providers configured yet. Add one above to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              onActivate={handleActivate}
              onEdit={(prov) => { setEditingProvider(prov); setShowAddForm(false); }}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
