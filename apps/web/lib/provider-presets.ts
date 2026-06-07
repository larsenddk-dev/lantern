/**
 * Provider presets — the single source of truth for the onboarding shortcuts.
 *
 * Shared by the Settings provider form and the first-run Welcome screen so a
 * new user can go from "fresh install" to "working chat" in a couple of clicks:
 * pick a preset, open the linked key page, paste the key, save.
 *
 * Every entry is an OpenAI-compatible endpoint (that's all the sidecar speaks).
 * `model` ids and "free" flags reflect what actually works on current free
 * accounts — keep them honest; a stale id here is the difference between
 * plug-and-play and a confusing 404 on the user's first message.
 */

export interface ProviderPreset {
  label: string;
  base_url: string;
  model: string;
  /** Where the user signs up / copies an API key. Omitted for local (no key). */
  apiKeyUrl?: string;
  /** True when the provider has a usable no-cost tier for this model. */
  free?: boolean;
  /** True for a local engine that needs no API key (Ollama). */
  local?: boolean;
  /** One-line plain-English hint shown in the Welcome cards. */
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: "Google Gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    // gemini-2.0-flash was retired (free quota dropped to 0); 2.5 Flash is the
    // current free-tier model and is verified working.
    model: "gemini-2.5-flash",
    apiKeyUrl: "https://aistudio.google.com/apikey",
    free: true,
    note: "Fast, capable, generous free tier. Easiest place to start.",
  },
  {
    label: "Cerebras",
    base_url: "https://api.cerebras.ai/v1",
    // Cerebras' free keys expose gpt-oss-120b / zai-glm-4.7; the older llama-4
    // scout id returns 404 "model not found" on current accounts.
    model: "gpt-oss-120b",
    apiKeyUrl: "https://cloud.cerebras.ai",
    free: true,
    note: "Very fast inference, free key, a strong open model.",
  },
  {
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    apiKeyUrl: "https://console.groq.com/keys",
    free: true,
    note: "Free tier with quick Llama 3.3 responses.",
  },
  {
    label: "Mistral",
    base_url: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    free: true,
    note: "European provider with a free experimentation tier.",
  },
  {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    // One key, hundreds of models. gpt-4o-mini is cheap and reliable; swap the
    // model for any "…:free" id to stay at no cost.
    model: "openai/gpt-4o-mini",
    apiKeyUrl: "https://openrouter.ai/keys",
    note: "One key, hundreds of models. Use a “…:free” model id for no cost.",
  },
  {
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    note: "Bring your own OpenAI key.",
  },
  {
    label: "Ollama (local)",
    base_url: "http://localhost:11434/v1",
    model: "llama3.2",
    local: true,
    note: "Runs fully offline on your machine — no API key needed.",
  },
];

/** The presets we steer new users toward first: free and verified working. */
export const RECOMMENDED_PRESETS = PROVIDER_PRESETS.filter((p) => p.free).slice(0, 3);
