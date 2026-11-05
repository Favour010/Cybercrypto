/**
 * Declarative description of each client portal's work-order form and the
 * steps an automation run goes through. The demo simulator uses these to
 * produce realistic step timelines; the Playwright worker (not yet built) is
 * intended to implement the same steps per portal adapter.
 *
 * Portals differ on purpose: field names, required fields and upload rules.
 */
import type { PortalSlug } from "@/lib/domain/portals";

export interface PortalFieldMapping {
  /** JobSync field → the portal's form label. */
  field: string;
  portalLabel: string;
  required: boolean;
}

export interface PortalSpec {
  slug: PortalSlug;
  formPath: string;
  requiresLogin: boolean;
  supportsAttachments: boolean;
  maxAttachmentMb: number;
  referencePattern: string;
  fields: PortalFieldMapping[];
  /** Typical simulated duration of one attempt, in seconds. */
  typicalSeconds: [number, number];
}

const common: PortalFieldMapping[] = [
  { field: "customer_name", portalLabel: "Customer", required: true },
  { field: "service_address", portalLabel: "Site address", required: true },
  { field: "description", portalLabel: "Fault description", required: true },
];

export const PORTAL_SPECS: Record<PortalSlug, PortalSpec> = {
  northstar: {
    slug: "northstar",
    formPath: "/work-orders/new",
    requiresLogin: true,
    supportsAttachments: true,
    maxAttachmentMb: 10,
    referencePattern: "NS-######",
    fields: [
      ...common,
      { field: "category", portalLabel: "Trade", required: true },
      { field: "priority", portalLabel: "Urgency", required: true },
      { field: "scheduled_date", portalLabel: "Attendance date", required: false },
    ],
    typicalSeconds: [24, 48],
  },
  bluepeak: {
    slug: "bluepeak",
    formPath: "/jobs/create",
    requiresLogin: true,
    supportsAttachments: true,
    maxAttachmentMb: 5,
    referencePattern: "BP-#####",
    fields: [
      ...common,
      { field: "contact.name", portalLabel: "Site contact", required: true },
      { field: "contact.phone", portalLabel: "Contact phone", required: false },
      { field: "priority", portalLabel: "Priority band", required: true },
    ],
    typicalSeconds: [30, 60],
  },
  greenfield: {
    slug: "greenfield",
    formPath: "/requests/new",
    requiresLogin: true,
    supportsAttachments: false,
    maxAttachmentMb: 0,
    referencePattern: "GF-####",
    fields: [
      ...common,
      { field: "category", portalLabel: "Service type", required: true },
      { field: "instructions", portalLabel: "Access notes", required: false },
    ],
    typicalSeconds: [18, 36],
  },
  apex: {
    slug: "apex",
    formPath: "/maintenance/submit",
    requiresLogin: true,
    supportsAttachments: true,
    maxAttachmentMb: 20,
    referencePattern: "APX-######",
    fields: [
      ...common,
      { field: "scheduled_date", portalLabel: "Required by", required: true },
      { field: "technician", portalLabel: "Assigned engineer", required: false },
    ],
    typicalSeconds: [35, 70],
  },
  metrocare: {
    slug: "metrocare",
    formPath: "/portal/work-order",
    requiresLogin: true,
    supportsAttachments: true,
    maxAttachmentMb: 8,
    referencePattern: "MC-#####",
    fields: [
      ...common,
      { field: "contact.email", portalLabel: "Requester email", required: true },
      { field: "category", portalLabel: "Discipline", required: true },
    ],
    typicalSeconds: [22, 44],
  },
};

export const EXECUTION_STEPS = [
  { key: "open", label: "Open portal" },
  { key: "login", label: "Authenticate" },
  { key: "navigate", label: "Open work-order form" },
  { key: "populate", label: "Populate fields" },
  { key: "attachments", label: "Upload attachments" },
  { key: "validate", label: "Validate form" },
  { key: "submit", label: "Submit work order" },
  { key: "confirm", label: "Capture confirmation" },
] as const;

export type ExecutionStepKey = (typeof EXECUTION_STEPS)[number]["key"];

/** Failures a real worker can meet. `retryable: false` always goes to a person. */
export const SIMULATED_FAILURES = [
  { code: "PORTAL_TIMEOUT", step: "open", retryable: true, message: "Portal did not respond within the timeout." },
  {
    code: "PORTAL_UNAVAILABLE",
    step: "open",
    retryable: true,
    message: "Portal returned HTTP 503 (service unavailable).",
  },
  {
    code: "SELECTOR_NOT_FOUND",
    step: "populate",
    retryable: true,
    message: "Expected form field was not found; the page may still be loading.",
  },
  { code: "UPLOAD_FAILED", step: "attachments", retryable: true, message: "Attachment upload was interrupted." },
  { code: "SESSION_EXPIRED", step: "login", retryable: true, message: "Portal session expired during the run." },
  {
    code: "CAPTCHA_DETECTED",
    step: "login",
    retryable: false,
    message: "Portal presented a CAPTCHA. JobSync never bypasses CAPTCHA; a person must complete this submission.",
  },
  {
    code: "MFA_REQUIRED",
    step: "login",
    retryable: false,
    message: "Portal requested multi-factor authentication. A person must sign in.",
  },
  {
    code: "PORTAL_VALIDATION_REJECTED",
    step: "validate",
    retryable: false,
    message: "Portal rejected the form: a required field is missing or invalid for this portal.",
  },
] as const;
