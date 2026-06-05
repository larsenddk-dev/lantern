export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SessionDetail extends Session {
  messages: Message[];
}

// ---------------------------------------------------------------------------
// Provider types (Phase 2a)
// ---------------------------------------------------------------------------

/** A provider config as returned by the API (key is always masked). */
export interface Provider {
  id: string;
  label: string;
  base_url: string;
  model: string;
  /** Masked key shown in UI — never the real value. */
  api_key_masked: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Payload to create a new provider. */
export interface CreateProviderPayload {
  label: string;
  base_url: string;
  model: string;
  api_key: string;
}

/** Payload for partial update of a provider. */
export interface UpdateProviderPayload {
  label?: string;
  base_url?: string;
  model?: string;
  api_key?: string;
}

/** Active provider wrapper returned by GET /providers/active. */
export interface ActiveProviderResponse {
  active: Provider | null;
}
