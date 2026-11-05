/**
 * Demo data layer state. Every entity mirrors a table in supabase/migrations
 * (same column names), so the demo engine and the Supabase backend share one
 * domain model and the UI can switch between them.
 */
import type { AppRole } from "@/lib/auth/permissions";
import type { PortalSlug } from "@/lib/domain/portals";
import type {
  ExecutionMode,
  ExecutionStatus,
  JobPriority,
  JobSourceType,
  JobStatus,
  TaskStatus,
} from "@/lib/domain/status";

export const DEMO_STATE_VERSION = 2;

export interface DemoUser {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  /** Inactive users keep their history but cannot act or be switched to. */
  is_active: boolean;
  created_at: string;
}

export interface DemoPortal {
  id: string;
  slug: PortalSlug;
  name: string;
  base_url: string;
  environment: "demo" | "production";
  is_enabled: boolean;
  automation_enabled: boolean;
  /** Only ever changed by a real, recorded connection test. */
  connection_status: "untested" | "ok" | "failed";
  last_connection_test_at: string | null;
  last_connection_error: string | null;
  last_connection_latency_ms: number | null;
  last_connection_http_status: number | null;
  notes: string;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface DemoRoutingRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  is_active: boolean;
  match_customer: string | null;
  match_category: string | null;
  match_priority: JobPriority | null;
  match_location: string | null;
  portal_slug: PortalSlug;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoJob {
  id: string;
  reference: string;
  organisation_id: string;
  source_type: JobSourceType;
  source: string;
  external_job_id: string | null;
  customer_name: string;
  service_address: string;
  category: string;
  priority: JobPriority;
  description: string;
  instructions: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  technician: string | null;
  status: JobStatus;
  /** Why the job needs a person (no routing match, portal review, …). */
  review_reason: string | null;
  received_at: string;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  raw_payload: unknown;
  submission_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoContact {
  id: string;
  job_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface DemoAttachment {
  id: string;
  job_id: string;
  file_name: string;
  content_type: string;
  size_bytes: number | null;
  /** Key of the file bytes in the browser's IndexedDB (uploaded in demo). */
  blob_key: string | null;
  /** External reference (intake payload attachments are links, not copies). */
  source_url: string | null;
  checksum_sha256: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export type AssignmentSource = "explicit" | "routing_rule" | "manual_override";

export interface DemoAssignment {
  id: string;
  job_id: string;
  portal_slug: PortalSlug;
  source: AssignmentSource;
  routing_rule_id: string | null;
  reason: string;
  assigned_by: string | null;
  created_at: string;
}

export interface DemoTask {
  id: string;
  job_id: string;
  portal_slug: PortalSlug;
  assignment_id: string;
  status: TaskStatus;
  execution_mode: ExecutionMode;
  idempotency_key: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  confirmation_reference: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecutionStep {
  key: string;
  label: string;
  status: "done" | "skipped" | "failed" | "pending";
  at: string | null;
  detail?: string;
}

export type SimulatedOutcome =
  | { kind: "success" }
  | { kind: "retryable"; code: string; message: string; failStep: string }
  | { kind: "human_review"; code: string; message: string; failStep: string };

export interface DemoExecution {
  id: string;
  task_id: string;
  job_id: string;
  portal_slug: PortalSlug;
  attempt: number;
  mode: ExecutionMode;
  status: ExecutionStatus;
  worker_id: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  confirmation_reference: string | null;
  screenshot_path: string | null;
  error_code: string | null;
  error_message: string | null;
  steps: ExecutionStep[];
  /** Always true in the demo layer: no browser was driven, no portal contacted. */
  simulated: true;
  /** Simulation plan, decided when the attempt starts. */
  plan: { outcome: SimulatedOutcome; ends_at: string } | null;
}

export type DemoEventStatus = "accepted" | "duplicate" | "rejected" | "failed" | "not_sent";

export interface DemoIntegrationEvent {
  id: string;
  integration: "intake" | "n8n" | "worker";
  direction: "inbound" | "outbound";
  event_type: string;
  status: DemoEventStatus;
  http_status: number | null;
  request_id: string;
  idempotency_key: string | null;
  job_id: string | null;
  payload: unknown;
  error: string | null;
  /** How the event entered the demo (seed history, simulator, sample generator). */
  origin: "seed" | "simulator" | "generator" | "engine";
  created_at: string;
}

export interface DemoAuditEntry {
  id: number;
  actor_id: string | null;
  actor_type: "user" | "system" | "integration" | "worker";
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown> | null;
  created_at: string;
}

export interface SystemSettings {
  /** The demo can only ever rehearse: LIVE needs server authorisation and a real worker. */
  execution_mode: "dry_run";
  max_concurrency: number;
  retry_limit: number;
  backoff_base_seconds: number;
  execution_timeout_seconds: number;
  polling_interval_seconds: number;
  auto_routing: boolean;
  worker_running: boolean;
  simulation: {
    failure_rate: number;
    human_review_rate: number;
    /** Multiplier applied to simulated step durations (1 = realistic). */
    speed: number;
  };
}

export interface IntegrationSettings {
  n8n: {
    outbound_enabled: boolean;
    webhook_url: string;
    events: string[];
    secret_configured: boolean;
    secret_hint: string | null;
    last_test: ConnectionTestResult | null;
  };
  playwright: {
    controller_url: string;
    last_test: ConnectionTestResult | null;
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  at: string;
  http_status: number | null;
  latency_ms: number | null;
  message: string;
}

export interface DemoState {
  version: number;
  seeded_at: string;
  seed: number;
  organisation: { id: string; name: string; slug: string };
  users: DemoUser[];
  current_user_id: string;
  portals: DemoPortal[];
  routing_rules: DemoRoutingRule[];
  jobs: DemoJob[];
  contacts: DemoContact[];
  attachments: DemoAttachment[];
  assignments: DemoAssignment[];
  tasks: DemoTask[];
  executions: DemoExecution[];
  events: DemoIntegrationEvent[];
  audit: DemoAuditEntry[];
  settings: SystemSettings;
  integrations: IntegrationSettings;
  counters: { job_reference: number; audit: number };
}
