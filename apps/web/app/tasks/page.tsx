import { CheckSquare } from "lucide-react";

export default function TasksPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <CheckSquare size={48} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Tasks</h1>
        <p style={{ color: "var(--muted-foreground)" }} className="text-sm max-w-sm">
          AI-assisted task management and tracking. Coming in a later phase.
        </p>
        <span className="inline-block mt-3 px-3 py-1 rounded-full text-xs font-medium" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
          Coming soon
        </span>
      </div>
    </div>
  );
}
