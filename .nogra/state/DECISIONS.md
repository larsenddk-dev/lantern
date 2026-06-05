# Decisions

Workspace: Lantern
Updated: 2026-06-05T08:06Z

## Project Decisions

- **Name:** "Lantern" — local-first, "carry your own light." Deliberately
  non-Greek (Odysseus's theme); brandable, warm, ownership-themed.
- **Inspiration:** PewDiePie's Odysseus
  (github.com/pewdiepie-archdaemon/odysseus) — but broader, more features, much
  better UI. New project from scratch, **not a fork**.
- **Stack:** React/Next.js + Tailwind CSS + shadcn/ui (frontend);
  Python + FastAPI (backend). Chosen for the strongest UI + an AI-friendly backend.
- **v0.1 scope:** broad feature "shell" — many areas visible; **chat fully
  functional** (multi-provider, streaming, sessions); other areas real-but-light
  modules / stubs.
- **AI providers:** all **free** tiers via an OpenAI-compatible layer
  (OpenRouter free, Google Gemini free, Groq, Mistral, Cerebras, …) + local Ollama.
- **Workflow:** Nogra (brief → GO → dispatch → evidence → verify).

## Local Decisions

- Nogra local records live in `.nogra/`.
- Memory is advisory continuity, not project truth.
- SessionStart is detector-only: no full memory load, no write, no dispatch.
