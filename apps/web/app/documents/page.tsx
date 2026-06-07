"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileText, Upload, Trash2, X, FileCheck2, FileX2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DocumentMeta, DocumentDetail } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// DocumentsPage
// ---------------------------------------------------------------------------

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DocumentDetail | null>(null);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const visibleDocs = filter.trim()
    ? docs.filter((d) =>
        d.filename.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : docs;

  const load = useCallback(async () => {
    try {
      setDocs(await api.listDocuments());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial list load — standard async-fetch-on-mount shape.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Deep-link: open a specific document when arriving via search (?focus=<id>).
  // openDocument intentionally fires once on mount with the URL param.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get("focus");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (focus) openDocument(focus);
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      // Upload sequentially so each failure is attributable.
      for (const file of Array.from(files)) {
        await api.uploadDocument(file);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openDocument(id: string) {
    try {
      setSelected(await api.getDocument(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open document");
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteDocument(id);
      if (selected?.id === id) setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // Drag-and-drop upload (depth counter avoids flicker from child enter/leave).
  function onDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      className="flex flex-col h-full relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div
          className="absolute inset-3 z-20 rounded-xl flex flex-col items-center justify-center gap-2 pointer-events-none"
          style={{ background: "var(--muted)", border: "2px dashed var(--primary)" }}
        >
          <Upload size={32} style={{ color: "var(--primary)" }} aria-hidden="true" />
          <p className="text-sm font-medium">Drop files to upload</p>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            .txt · .md · .pdf · .docx
          </p>
        </div>
      )}
      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <FileText size={18} aria-hidden="true" />
          <h1 className="text-sm font-semibold">Documents</h1>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Upload size={14} aria-hidden="true" />
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </header>

      {error && (
        <div
          className="mx-6 mt-4 px-3 py-2 rounded-md text-xs"
          style={{ background: "var(--destructive, #fee)", color: "var(--destructive-foreground, #900)" }}
        >
          {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* List */}
        <div className="flex-1 overflow-y-auto p-6">
          {docs.length > 3 && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter documents…"
              className="w-full mb-4 px-3 py-2 rounded-md text-sm border outline-none"
              style={{ borderColor: "var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
            />
          )}
          {loading ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <FileText size={40} style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">No documents yet</p>
                <p className="text-xs mt-1 max-w-xs" style={{ color: "var(--muted-foreground)" }}>
                  Drag &amp; drop files here, or use Upload — .txt, .md, .pdf or .docx.
                  Lantern extracts the text so you can read it here.
                </p>
              </div>
            </div>
          ) : visibleDocs.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              No documents match &ldquo;{filter}&rdquo;.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibleDocs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md border transition-colors"
                  style={{
                    borderColor: "var(--border)",
                    background: selected?.id === doc.id ? "var(--muted)" : "transparent",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openDocument(doc.id)}
                    className="flex items-center gap-3 flex-1 text-left min-w-0"
                  >
                    {doc.has_text ? (
                      <FileCheck2 size={18} className="shrink-0" style={{ color: "var(--primary)" }} aria-hidden="true" />
                    ) : (
                      <FileX2 size={18} className="shrink-0" style={{ color: "var(--muted-foreground)" }} aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.filename}</p>
                      <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                        {formatBytes(doc.size_bytes)} · {formatDate(doc.created_at)}
                        {!doc.has_text && " · no text extracted"}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(doc.id)}
                    aria-label={`Delete ${doc.filename}`}
                    className="p-1.5 rounded-md transition-opacity hover:opacity-70"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <aside
            className="w-1/2 max-w-2xl overflow-y-auto p-6 shrink-0"
            style={{ borderLeft: "1px solid var(--border)" }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">{selected.filename}</h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>
                  {selected.content_type || "unknown type"} · {formatBytes(selected.size_bytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="p-1.5 rounded-md hover:opacity-70"
                style={{ color: "var(--muted-foreground)" }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {selected.extracted_text.trim() ? (
              <pre
                className="text-xs whitespace-pre-wrap break-words font-sans leading-relaxed"
                style={{ color: "var(--foreground)" }}
              >
                {selected.extracted_text}
              </pre>
            ) : (
              <p className="text-xs italic" style={{ color: "var(--muted-foreground)" }}>
                No text could be extracted from this file (it may be a scanned image,
                an unsupported type, or empty).
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
