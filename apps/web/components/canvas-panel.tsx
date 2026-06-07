"use client";

import { useState, useEffect, useRef } from "react";
import {
  X, Copy, Check, Download, Code2, Eye, ChevronLeft, ChevronRight,
  Sparkles, Loader2, History,
} from "lucide-react";
import type { Artifact } from "@/lib/artifacts";
import {
  currentContent, isPreviewable, languageLabel, extensionForLanguage,
  previewDocument,
} from "@/lib/artifacts";
import { Markdown } from "@/components/markdown";
import { downloadText } from "@/lib/export";
import { slugify } from "@/lib/export";

type Tab = "code" | "preview";

/**
 * Canvas — a focused, editable, versioned workspace for one artifact, shown to
 * the right of the chat. Manual edits mutate the current version live; AI edits
 * (and the original) are distinct versions you can step through.
 */
export function CanvasPanel({
  artifact,
  onEditContent,
  onSelectVersion,
  onAiEdit,
  onClose,
  aiBusy,
}: {
  artifact: Artifact;
  /** Persist a manual edit to the current version's content. */
  onEditContent: (content: string) => void;
  onSelectVersion: (index: number) => void;
  /** Ask the model to revise the artifact with a natural-language instruction. */
  onAiEdit: (instruction: string) => void;
  onClose: () => void;
  /** True while an AI revision is streaming. */
  aiBusy: boolean;
}) {
  const previewable = isPreviewable(artifact.kind);
  const [tab, setTab] = useState<Tab>(previewable ? "preview" : "code");
  const [copied, setCopied] = useState(false);
  const [instruction, setInstruction] = useState("");
  const content = currentContent(artifact);

  // If the artifact kind flips (e.g. opening a new canvas) reset to a sane tab.
  useEffect(() => {
    setTab(isPreviewable(artifact.kind) ? "preview" : "code");
  }, [artifact.id, artifact.kind]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download() {
    const ext = extensionForLanguage(artifact.language);
    downloadText(`${slugify(artifact.title)}.${ext}`, content, "text/plain;charset=utf-8");
  }

  function submitAiEdit() {
    const text = instruction.trim();
    if (!text || aiBusy) return;
    onAiEdit(text);
    setInstruction("");
  }

  const multiVersion = artifact.versions.length > 1;

  return (
    <div
      className="flex flex-col h-full min-w-0 border-l"
      style={{ borderColor: "var(--border)", background: "var(--background)" }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <Code2 size={15} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" title={artifact.title}>
            {artifact.title}
          </p>
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            {languageLabel(artifact.language)}
            {multiVersion && ` · v${artifact.current + 1} of ${artifact.versions.length}`}
          </p>
        </div>

        {/* Version stepper */}
        {multiVersion && (
          <div className="flex items-center gap-0.5 mr-1">
            <button
              onClick={() => onSelectVersion(Math.max(0, artifact.current - 1))}
              disabled={artifact.current === 0}
              className="p-1 rounded disabled:opacity-30 hover:opacity-80"
              style={{ color: "var(--muted-foreground)" }}
              title="Previous version"
              aria-label="Previous version"
            >
              <ChevronLeft size={14} />
            </button>
            <History size={13} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
            <button
              onClick={() => onSelectVersion(Math.min(artifact.versions.length - 1, artifact.current + 1))}
              disabled={artifact.current === artifact.versions.length - 1}
              className="p-1 rounded disabled:opacity-30 hover:opacity-80"
              style={{ color: "var(--muted-foreground)" }}
              title="Next version"
              aria-label="Next version"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Code / Preview tabs */}
        {previewable && (
          <div
            className="flex items-center rounded-md p-0.5 text-[11px]"
            style={{ background: "var(--muted)" }}
          >
            <button
              onClick={() => setTab("preview")}
              className="flex items-center gap-1 px-2 py-1 rounded"
              style={
                tab === "preview"
                  ? { background: "var(--background)", color: "var(--foreground)" }
                  : { color: "var(--muted-foreground)" }
              }
            >
              <Eye size={12} aria-hidden="true" /> Preview
            </button>
            <button
              onClick={() => setTab("code")}
              className="flex items-center gap-1 px-2 py-1 rounded"
              style={
                tab === "code"
                  ? { background: "var(--background)", color: "var(--foreground)" }
                  : { color: "var(--muted-foreground)" }
              }
            >
              <Code2 size={12} aria-hidden="true" /> Code
            </button>
          </div>
        )}

        <button
          onClick={copy}
          className="p-1.5 rounded hover:opacity-80"
          style={{ color: "var(--muted-foreground)" }}
          title="Copy contents"
          aria-label="Copy contents"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button
          onClick={download}
          className="p-1.5 rounded hover:opacity-80"
          style={{ color: "var(--muted-foreground)" }}
          title="Download file"
          aria-label="Download file"
        >
          <Download size={14} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:opacity-80"
          style={{ color: "var(--muted-foreground)" }}
          title="Close canvas"
          aria-label="Close canvas"
        >
          <X size={15} />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 relative">
        {tab === "preview" && previewable ? (
          artifact.kind === "markdown" ? (
            <div className="h-full overflow-y-auto px-6 py-4 text-sm">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <iframe
              // No allow-same-origin: artifact scripts can't reach the app.
              sandbox="allow-scripts"
              srcDoc={previewDocument(artifact)}
              title={`Preview of ${artifact.title}`}
              className="w-full h-full border-0 bg-white"
            />
          )
        ) : (
          <CodeEditor
            key={`${artifact.id}-${artifact.current}`}
            value={content}
            onChange={onEditContent}
          />
        )}

        {aiBusy && (
          <div
            className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-4 py-1.5 text-[11px]"
            style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}
          >
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            Lantern is revising the canvas…
          </div>
        )}
      </div>

      {/* AI edit footer */}
      <div className="shrink-0 px-3 py-2.5 border-t" style={{ borderColor: "var(--border)" }}>
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-1.5"
          style={{ border: "1px solid var(--border)", background: "var(--muted)" }}
        >
          <Sparkles size={14} className="mb-1.5 shrink-0" style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
          <textarea
            rows={1}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitAiEdit();
              }
            }}
            placeholder="Ask Lantern to edit this canvas…"
            disabled={aiBusy}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:opacity-50 max-h-28 py-1"
            style={{ color: "var(--foreground)" }}
            aria-label="Ask Lantern to edit the canvas"
          />
          <button
            onClick={submitAiEdit}
            disabled={aiBusy || !instruction.trim()}
            className="shrink-0 mb-0.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-opacity disabled:opacity-30"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {aiBusy ? <Loader2 size={13} className="animate-spin" /> : "Edit"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * A lightweight editable code surface. A plain monospace textarea keeps editing
 * dependable (no contenteditable quirks) while tabs insert two spaces.
 */
function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const el = e.currentTarget;
          const start = el.selectionStart;
          const end = el.selectionEnd;
          const next = value.slice(0, start) + "  " + value.slice(end);
          onChange(next);
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = start + 2;
          });
        }
      }}
      spellCheck={false}
      className="w-full h-full resize-none outline-none px-4 py-3 font-mono text-[12.5px] leading-relaxed"
      style={{ background: "var(--background)", color: "var(--foreground)", tabSize: 2 }}
      aria-label="Edit artifact content"
    />
  );
}
