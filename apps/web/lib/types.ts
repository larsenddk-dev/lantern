export interface MessageAttachment {
  id: string;
  message_id: string;
  kind: "image";
  mime_type: string;
  filename: string | null;
  size_bytes: number;
  created_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  attachments?: MessageAttachment[];
}

/**
 * Image (today) attached to an outgoing chat turn — sent inline base64
 * so the call is self-contained and we don't need a pre-upload roundtrip.
 */
export interface ChatAttachmentInput {
  filename?: string;
  mime_type: string;
  data_base64: string;
}

export interface Session {
  id: string;
  title: string;
  /** Optional reference to a saved Prompt (from /prompts). When set, that
   * prompt's content is injected as the system message on every chat turn. */
  system_prompt_id?: string | null;
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

// ---------------------------------------------------------------------------
// Memory types
// ---------------------------------------------------------------------------

export interface Memory {
  id: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryPayload {
  content: string;
  pinned?: boolean;
}

export interface UpdateMemoryPayload {
  content?: string;
  pinned?: boolean;
}

// ---------------------------------------------------------------------------
// Compare types
// ---------------------------------------------------------------------------

export interface CompareTarget {
  provider_id?: string;
  model?: string;
}

export interface CompareResult {
  model: string;
  reply: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface AgentResponse {
  reply: string;
  steps: AgentStep[];
}

// ---------------------------------------------------------------------------
// Deep Research types
// ---------------------------------------------------------------------------

export interface ResearchSource {
  source_type: string;
  content: string;
  score: number;
  url?: string | null;
}

export interface ResearchFinding {
  subquestion: string;
  sources: ResearchSource[];
}

export interface ResearchResponse {
  question: string;
  subquestions: string[];
  findings: ResearchFinding[];
  report: string;
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------

export interface SearchHit {
  type: "note" | "task" | "document" | "memory" | "chat";
  id: string;
  title: string;
  snippet: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Email (read-only IMAP)
// ---------------------------------------------------------------------------

export interface EmailMeta {
  uid: string;
  subject: string;
  from: string;
  date: string;
}

export interface EmailListResponse {
  configured: boolean;
  emails: EmailMeta[];
  note?: string;
  error?: string;
}

export interface EmailDetail {
  configured: boolean;
  uid?: string;
  subject?: string;
  from?: string;
  date?: string;
  body?: string;
  error?: string;
}

export interface EmailTriage {
  configured: boolean;
  uid?: string;
  summary?: string;
  note?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Calendar (read-only CalDAV)
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location: string | null;
  calendar: string;
}

export interface CalendarResponse {
  configured: boolean;
  events: CalendarEvent[];
  note?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export interface Prompt {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePromptPayload {
  title?: string;
  content?: string;
}

export interface UpdatePromptPayload {
  title?: string;
  content?: string;
}

// ---------------------------------------------------------------------------
// Starred messages
// ---------------------------------------------------------------------------

export interface StarredMessage {
  id: string;
  session_id: string;
  session_title: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cookbook (local Ollama integration)
// ---------------------------------------------------------------------------

export interface CookbookStatus {
  running: boolean;
  version?: string;
  model_count?: number;
  base_url?: string;
  error?: string;
}

export interface CookbookHardware {
  os: string;
  cpu: string;
  ram_gb: number;
  gpu: string | null;
  apple_silicon: boolean;
}

export type CookbookFit = "recommended" | "ok" | "tight" | "too_big" | "unknown";

export interface CookbookModel {
  id: string;
  name: string;
  size_gb: number;
  min_ram_gb: number;
  recommended_ram_gb: number;
  tags: string[];
  description: string;
  fit: CookbookFit;
}

export interface CookbookCatalog {
  hardware: CookbookHardware;
  models: CookbookModel[];
}

export interface CookbookInstalledModel {
  name: string;
  size?: number;
  modified_at?: string;
  digest?: string;
}

export interface CookbookPullEvent {
  status: string;
  completed?: number;
  total?: number;
  error?: string;
}

export interface Stats {
  sessions: number;
  messages: number;
  messages_user: number;
  messages_assistant: number;
  notes: number;
  tasks: number;
  tasks_done: number;
  documents: number;
  memories: number;
  memories_pinned: number;
  prompts: number;
  embeddings: number;
  providers: number;
  starred_messages: number;
}
