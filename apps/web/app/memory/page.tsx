import { Brain } from "lucide-react";

export default function MemoryPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <Brain size={48} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Memory</h1>
        <p style={{ color: "var(--muted-foreground)" }} className="text-sm max-w-sm">
          Long-term memory and RAG retrieval so your AI remembers context across sessions. Coming in a later phase.
        </p>
        <span className="inline-block mt-3 px-3 py-1 rounded-full text-xs font-medium" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
          Coming soon
        </span>
      </div>
    </div>
  );
}
