"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** A fenced code block with a hover "Copy" button. */
function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="relative my-2 group/code">
      <button
        onClick={copy}
        className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] opacity-0 group-hover/code:opacity-100 transition-opacity"
        style={{ background: "var(--background)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
        title="Copy code"
        aria-label="Copy code"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre
        ref={ref}
        className="p-3 rounded-md overflow-x-auto text-[0.85em] leading-relaxed"
        style={{ background: "color-mix(in srgb, var(--foreground) 6%, transparent)", border: "1px solid var(--border)" }}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * Shared markdown renderer for assistant chat replies and research reports.
 *
 * Styled with the app's CSS variables so it matches the surrounding UI in both
 * light and dark. GFM is enabled (tables, task lists, strikethrough, autolinks).
 * Code is styled but not syntax-highlighted, to keep the static bundle light.
 *
 * Inline code / code blocks use a `color-mix` overlay on `--foreground` so they
 * contrast on any background — the muted chat bubble as well as the page.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0 leading-relaxed">{children}</p>
          ),
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 first:mt-0 text-lg font-semibold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 first:mt-0 text-base font-semibold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 first:mt-0 text-sm font-semibold">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="my-2 pl-5 list-disc space-y-1 marker:opacity-50">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 pl-5 list-decimal space-y-1 marker:opacity-50">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:opacity-80"
              style={{ color: "var(--primary)" }}
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote
              className="my-2 pl-3 border-l-2 italic"
              style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}
            >
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3" style={{ borderColor: "var(--border)" }} />,
          code: ({ node, className, children, ...props }) => {
            const isBlock = /language-(\w+)/.test(className || "");
            if (isBlock) {
              return (
                <code className={cn("font-mono", className)} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="px-1 py-0.5 rounded font-mono text-[0.85em]"
                style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-left border-collapse text-[0.95em]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="px-2 py-1 font-medium" style={{ borderBottom: "1px solid var(--border)" }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2 py-1 align-top" style={{ borderBottom: "1px solid var(--border)" }}>
              {children}
            </td>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
