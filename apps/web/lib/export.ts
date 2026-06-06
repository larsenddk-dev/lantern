/**
 * Client-side export helpers — turn chat/research into a downloadable .md file.
 */

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
