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

// ---------------------------------------------------------------------------
// Notes types (Phase 2b)
// ---------------------------------------------------------------------------

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface CreateNotePayload {
  title?: string;
  content?: string;
}

export interface UpdateNotePayload {
  title?: string;
  content?: string;
}

// ---------------------------------------------------------------------------
// Tasks types (Phase 2b)
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskPayload {
  title: string;
}

export interface UpdateTaskPayload {
  title?: string;
  done?: boolean;
}

// ---------------------------------------------------------------------------
// Documents types (Phase 2c)
// ---------------------------------------------------------------------------

/** Document metadata as returned by list/upload (list omits the full text). */
export interface DocumentMeta {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  /** Whether any text was extracted from the file. */
  has_text: boolean;
  created_at: string;
}

/** A single document including its extracted text (from GET /documents/{id}). */
export interface DocumentDetail extends DocumentMeta {
  extracted_text: string;
}
