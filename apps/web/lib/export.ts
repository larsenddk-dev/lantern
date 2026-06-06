/**
 * Client-side export helpers — turn chat/research into a downloadable .md or
 * .pdf file.
 */

import { jsPDF } from "jspdf";

export function slugify(s: string): string {
  return (
    (s || "untitled")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** Trigger a browser download of a text file (works in the Tauri WebView too). */
export function downloadText(
  filename: string,
  content: string,
  mime = "text/markdown;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download `body` as a simple paginated PDF with an optional title. Renders
 * plain text (word-wrapped) — good for chat transcripts and research reports.
 */
export function downloadPdf(filename: string, title: string, body: string): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 56;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  function ensureSpace(lineH: number) {
    if (y + lineH > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }

  if (title) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    for (const line of doc.splitTextToSize(title, maxW)) {
      ensureSpace(22);
      doc.text(line, margin, y);
      y += 22;
    }
    y += 8;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const lineH = 16;
  // Preserve blank lines / paragraphs while wrapping long lines.
  for (const rawLine of body.replace(/\r/g, "").split("\n")) {
    const wrapped = rawLine.trim() === "" ? [""] : doc.splitTextToSize(rawLine, maxW);
    for (const line of wrapped) {
      ensureSpace(lineH);
      doc.text(line, margin, y);
      y += lineH;
    }
  }

  doc.save(filename);
}

/** Render a chat transcript as Markdown. */
export function chatToMarkdown(
  title: string,
  messages: { role: "user" | "assistant"; content: string }[],
): string {
  const header = `# ${title || "Chat"}\n\n*Exported from Lantern*\n`;
  const body = messages
    .filter((m) => m.content.trim())
    .map((m) => `## ${m.role === "user" ? "You" : "Lantern"}\n\n${m.content.trim()}`)
    .join("\n\n");
  return `${header}\n${body}\n`;
}
