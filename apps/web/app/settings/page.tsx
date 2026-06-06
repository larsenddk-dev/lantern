import { ProviderSettings } from "@/components/provider-settings";
import { EmbeddingsSettings } from "@/components/embeddings-settings";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header
        className="px-8 py-5 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
          Configure AI providers and workspace preferences.
        </p>
      </header>

      <div className="flex-1 px-8 py-6 max-w-2xl flex flex-col gap-8">
        <ProviderSettings />
        <div style={{ borderTop: "1px solid var(--border)" }} />
        <EmbeddingsSettings />
      </div>
    </div>
  );
}
