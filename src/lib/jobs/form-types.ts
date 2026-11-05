/** Job form values and editable-job shape, shared by the server and the browser. */
import type { PortalSlug } from "@/lib/domain/portals";
import type { JobPriority } from "@/lib/domain/status";

export interface FormPortal {
  slug: PortalSlug;
  name: string;
  is_enabled: boolean;
}

export interface JobFormValues {
  customer_name: string;
  service_address: string;
  category: string;
  priority: JobPriority;
  description: string;
  instructions: string;
  scheduled_date: string;
  scheduled_time: string;
  technician: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  destinations: string[];
}

export const EMPTY_JOB_FORM: JobFormValues = {
  customer_name: "",
  service_address: "",
  category: "",
  priority: "normal",
  description: "",
  instructions: "",
  scheduled_date: "",
  scheduled_time: "",
  technician: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  destinations: [],
};

export interface EditableJob {
  id: string;
  reference: string;
  source_type: "external" | "manual";
  source: string;
  external_job_id: string | null;
  archived: boolean;
  updated_at: string;
  values: JobFormValues;
  /** Destinations whose task was attempted: they cannot be removed. */
  lockedDestinations: string[];
  submittedCount: number;
  processing: boolean;
  attachments: { id: string; file_name: string; size_bytes: number | null }[];
}
