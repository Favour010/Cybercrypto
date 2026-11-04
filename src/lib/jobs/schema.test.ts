import { describe, expect, it } from "vitest";

import { cleanText, formDataToJobInput, intakePayloadSchema, jobFormSchema, toFieldErrors } from "@/lib/jobs/schema";

const VALID = {
  external_job_id: " ARO-2026-00125 ",
  source: "AroFlo",
  customer: "Example Facilities Ltd",
  contact: { name: "John Smith", email: "John@Example.com", phone: "+2348000000000" },
  service_address: "Example Service Address",
  category: "AC Maintenance",
  priority: "High",
  description: "Air conditioning unit requires inspection.",
  scheduled_date: "2026-11-05",
  scheduled_time: "10:00",
  destinations: ["northstar", "bluepeak"],
};

describe("cleanText", () => {
  it("strips control characters and collapses single-line whitespace", () => {
    expect(cleanText("  Acme\u0000  Ltd\u0007 ")).toBe("Acme Ltd");
    expect(cleanText("line 1  \r\nline 2\t", true)).toBe("line 1\nline 2");
  });
});

describe("intakePayloadSchema", () => {
  it("normalises a valid payload", () => {
    const r = intakePayloadSchema.parse(VALID);
    expect(r).toMatchObject({
      external_job_id: "ARO-2026-00125",
      source: "aroflo",
      priority: "high",
      scheduled_time: "10:00:00",
      contact: { name: "John Smith", email: "john@example.com", phone: "+2348000000000" },
      destinations: ["northstar", "bluepeak"],
      attachments: [],
      instructions: null,
      technician: null,
    });
  });

  it("maps priority synonyms and defaults to normal", () => {
    expect(intakePayloadSchema.parse({ ...VALID, priority: "Medium" }).priority).toBe("normal");
    expect(intakePayloadSchema.parse({ ...VALID, priority: "EMERGENCY" }).priority).toBe("urgent");
    expect(intakePayloadSchema.parse({ ...VALID, priority: undefined }).priority).toBe("normal");
  });

  it("allows a missing contact and no destinations", () => {
    const r = intakePayloadSchema.parse({ ...VALID, contact: undefined, destinations: undefined });
    expect(r.contact).toBeNull();
    expect(r.destinations).toEqual([]);
  });

  it("requires a contact name when email or phone is given", () => {
    const r = intakePayloadSchema.safeParse({ ...VALID, contact: { email: "a@b.co" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["contact", "name"]);
  });

  it("rejects impossible dates and times", () => {
    for (const [field, value] of [
      ["scheduled_date", "2026-02-30"],
      ["scheduled_date", "05/11/2026"],
      ["scheduled_time", "24:00"],
      ["scheduled_time", "9am"],
    ]) {
      expect(intakePayloadSchema.safeParse({ ...VALID, [field]: value }).success, `${field}=${value}`).toBe(false);
    }
  });

  it("never accepts a catch-all destination", () => {
    for (const d of [["all"], ["*"], ["northstar", "everywhere"], [42]]) {
      expect(intakePayloadSchema.safeParse({ ...VALID, destinations: d }).success).toBe(false);
    }
  });

  it("enforces field length limits", () => {
    expect(intakePayloadSchema.safeParse({ ...VALID, customer: "x".repeat(201) }).success).toBe(false);
    expect(intakePayloadSchema.safeParse({ ...VALID, external_job_id: "" }).success).toBe(false);
  });

  it("rejects source names that are not identifiers", () => {
    expect(intakePayloadSchema.safeParse({ ...VALID, source: "Aro Flo!" }).success).toBe(false);
  });
});

describe("jobFormSchema", () => {
  function form(entries: Record<string, string | string[]>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
    return f;
  }

  it("parses the Create Job form", () => {
    const r = jobFormSchema.parse(
      formDataToJobInput(
        form({
          customer_name: "Harbour View",
          service_address: "12 Quay Road",
          category: "Plumbing",
          priority: "urgent",
          description: "Burst pipe",
          contact_name: "",
          contact_email: "",
          contact_phone: "",
          destinations: ["apex", "apex"],
          scheduled_date: "",
          scheduled_time: "",
        }),
      ),
    );
    expect(r).toMatchObject({ contact: null, destinations: ["apex"], scheduled_date: null, priority: "urgent" });
  });

  it("reports errors under form field names", () => {
    const r = jobFormSchema.safeParse(formDataToJobInput(form({ contact_email: "nope", contact_name: "X" })));
    expect(r.success).toBe(false);
    const errors = toFieldErrors(r.error!);
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(["customer_name", "service_address", "category", "description", "contact_email"]),
    );
  });
});
