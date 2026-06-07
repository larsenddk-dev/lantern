/**
 * Canvas / Artifacts — turn substantial code or document blocks in an
 * assistant reply into a first-class, editable, versioned artifact that opens
 * in the Canvas side panel.
 *
 * This is deliberately frontend-only: an artifact is derived from a chat
 * message's fenced code block and lives in component state for the session.
 * Iteration ("ask Lantern to edit this") rides the normal chat stream, so no
 * new backend endpoints are needed.
 */

export type ArtifactKind = "html" | "svg" | "markdown" | "code";

export interface Artifact {
  /** Stable id (the source message id, or a synthetic one for blank canvases). */
  id: string;
  title: string;
  language: string;
  kind: ArtifactKind;
  /** Full content for each revision; index 0 is the original. */
  versions: string[];
  /** Which version is currently shown/edited. */
  current: number;
}

// A fenced code block: ```lang\n…\n```  (lang optional)
const FENCE_RE = /```([\w.+-]*)[^\n]*\n([\s\S]*?)```/g;

interface Block {
  language: string;
  code: string;
}

/** Pull every fenced code block out of a markdown string, in order. */
function allBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let m: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((m = FENCE_RE.exec(markdown)) !== null) {
    const language = (m[1] || "").trim().toLowerCase();
    const code = m[2].replace(/\n$/, "");
    if (code.trim()) blocks.push({ language, code });
  }
  return blocks;
}

export function kindForLanguage(language: string): ArtifactKind {
  const l = language.toLowerCase();
  if (l === "html" || l === "htm") return "html";
  if (l === "svg") return "svg";
  if (l === "markdown" || l === "md") return "markdown";
  return "code";
}

/** Whether this kind can be shown in a live Preview tab. */
export function isPreviewable(kind: ArtifactKind): boolean {
  return kind === "html" || kind === "svg" || kind === "markdown";
}

const EXT: Record<string, string> = {
  javascript: "js", js: "js", jsx: "jsx", typescript: "ts", ts: "ts", tsx: "tsx",
  python: "py", py: "py", html: "html", htm: "html", css: "css", scss: "scss",
  json: "json", yaml: "yaml", yml: "yml", markdown: "md", md: "md", svg: "svg",
  bash: "sh", sh: "sh", shell: "sh", sql: "sql", rust: "rs", go: "go", java: "java",
  c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs", ruby: "rb", php: "php",
  toml: "toml", xml: "xml", text: "txt", "": "txt",
};

export function extensionForLanguage(language: string): string {
  return EXT[language.toLowerCase()] ?? "txt";
}

const LANG_LABEL: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", jsx: "JSX", ts: "TypeScript",
  typescript: "TypeScript", tsx: "TSX", py: "Python", python: "Python",
  html: "HTML", htm: "HTML", css: "CSS", json: "JSON", md: "Markdown",
  markdown: "Markdown", svg: "SVG", sh: "Shell", bash: "Shell", sql: "SQL",
  rust: "Rust", go: "Go", java: "Java", cpp: "C++", c: "C",
};

export function languageLabel(language: string): string {
  if (!language) return "Text";
  return LANG_LABEL[language.toLowerCase()] ?? language.toUpperCase();
}

/** Best-effort human title for the artifact derived from its content. */
function deriveTitle(block: Block): string {
  const { language, code } = block;
  const kind = kindForLanguage(language);
  if (kind === "html") {
    const t = /<title>([^<]+)<\/title>/i.exec(code);
    if (t) return t[1].trim();
    const h1 = /<h1[^>]*>([^<]+)<\/h1>/i.exec(code);
    if (h1) return h1[1].trim().slice(0, 60);
  }
  if (kind === "markdown") {
    const h = /^#\s+(.+)$/m.exec(code);
    if (h) return h[1].trim().slice(0, 60);
  }
  // A leading `// file: name` or `# name` comment is a nice title hint.
  const firstLine = code.split("\n")[0].trim();
  const comment = /^(?:\/\/|#|--|<!--)\s*(.+?)\s*(?:-->)?$/.exec(firstLine);
  if (comment && comment[1].length <= 60 && /[a-z]/i.test(comment[1])) {
    return comment[1];
  }
  return `${languageLabel(language)} document`;
}

/**
 * Decide whether a message's content is worth opening in Canvas, and if so
 * return the artifact-worthy block. We pick the *largest* qualifying block so
 * a reply that's mostly prose plus one big snippet still surfaces the snippet.
 *
 * Qualifies: any html/svg/markdown block, or a code block with real heft
 * (≥4 lines or ≥160 chars). Trivial one-liners stay inline in chat.
 */
export function extractArtifactBlock(
  content: string,
): { language: string; code: string; title: string; kind: ArtifactKind } | null {
  const blocks = allBlocks(content);
  if (blocks.length === 0) return null;

  const qualifying = blocks.filter((b) => {
    const kind = kindForLanguage(b.language);
    if (isPreviewable(kind)) return true;
    const lines = b.code.split("\n").length;
    return lines >= 4 || b.code.length >= 160;
  });
  if (qualifying.length === 0) return null;

  const best = qualifying.reduce((a, b) => (b.code.length > a.code.length ? b : a));
  return {
    language: best.language,
    code: best.code,
    title: deriveTitle(best),
    kind: kindForLanguage(best.language),
  };
}

/** True if the message has something Canvas-worthy (drives the chat button). */
export function hasArtifact(content: string): boolean {
  return extractArtifactBlock(content) !== null;
}

/** Build a fresh Artifact from a chat message. */
export function artifactFromMessage(messageId: string, content: string): Artifact | null {
  const block = extractArtifactBlock(content);
  if (!block) return null;
  return {
    id: messageId,
    title: block.title,
    language: block.language || "text",
    kind: block.kind,
    versions: [block.code],
    current: 0,
  };
}

/** The content of the currently-selected version. */
export function currentContent(a: Artifact): string {
  return a.versions[a.current] ?? "";
}

/** Wrap an SVG/HTML fragment into a full document for the preview iframe. */
export function previewDocument(a: Artifact): string {
  const code = currentContent(a);
  if (a.kind === "html") return code;
  if (a.kind === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}
      svg{max-width:100%;max-height:100%}
    </style></head><body>${code}</body></html>`;
  }
  return code;
}
