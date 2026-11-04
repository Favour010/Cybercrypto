# External job intake API

`POST /api/v1/jobs/intake` receives one work order from an external system (AroFlo, n8n, or any client that can send HTTPS JSON). It works on its own. n8n is optional.

> **AroFlo.** JobSync does not connect to AroFlo directly. An authorised integration (for example an n8n workflow using AroFlo's approved API, run with credentials you hold) must call this endpoint. Nothing here claims or implies a direct AroFlo connection.

## Authentication

Every request needs an intake API key, created by an admin on **Incoming Jobs → Intake API keys**:

```
Authorization: Bearer jsk_<prefix>_<secret>
```

(`X-API-Key: <key>` is also accepted.)

- A key belongs to **one organisation**. Jobs always land in that organisation, whatever the payload says.
- A key may only submit jobs for its **allowed sources** (e.g. `aroflo`).
- Keys can expire and be revoked. JobSync stores only a SHA-256 hash, and the plaintext is shown once.
- Wrong, revoked and expired keys all receive the same `401`.

## Request

`Content-Type: application/json`, at most **1 MiB**.

```json
{
  "external_job_id": "ARO-2026-00125",
  "source": "aroflo",
  "customer": "Example Facilities Ltd",
  "contact": { "name": "John Smith", "email": "john@example.com", "phone": "+2348000000000" },
  "service_address": "Example Service Address",
  "category": "AC Maintenance",
  "priority": "High",
  "description": "Air conditioning unit requires inspection.",
  "instructions": "Inspect the unit and upload photographic evidence.",
  "scheduled_date": "2026-11-05",
  "scheduled_time": "10:00",
  "technician": "Technician A",
  "destinations": ["northstar", "bluepeak"],
  "attachments": [
    { "file_name": "unit.jpg", "url": "https://files.example.com/unit.jpg", "content_type": "image/jpeg", "size_bytes": 20480 }
  ]
}
```

| Field | Rules |
| --- | --- |
| `external_job_id` | **Required.** 1–120 chars. With `source`, identifies the job in the source system |
| `source` | **Required.** Lowercase identifier, e.g. `aroflo`. Must be allowed for the key |
| `customer`, `service_address`, `category`, `description` | **Required.** Up to 200 / 500 / 100 / 5000 chars |
| `contact` | Optional. `name` is required if `email` or `phone` is given |
| `priority` | `low`, `normal`, `high`, `urgent` (case-insensitive; `medium` → `normal`, `critical`/`emergency` → `urgent`). Default `normal` |
| `scheduled_date` / `scheduled_time` | `YYYY-MM-DD` (real calendar date) / `HH:MM` 24-hour |
| `destinations` | Optional list of `northstar`, `bluepeak`, `greenfield`, `apex`, `metrocare`. Unknown or disabled portals are rejected. There is no "all" value |
| `attachments` | Optional, up to 20 **references** (`https://` URLs). They are stored as links, not downloaded at intake |

Unknown fields are ignored and listed in `warnings`. The original payload is kept unchanged with the job.

## What happens

In one database transaction (`public.ingest_job`):

1. The job is stored with its source, external ID and original payload. These can never be changed afterwards.
2. The contact and attachment references are stored.
3. **Each listed destination** gets one assignment (reason "Listed in the intake payload destinations") and one `pending` submission task.
4. The job status is `ready` when it has destinations, or `received` (awaiting routing) when it has none. A received job is **never** marked submitted; submission happens later in the automation queue.

## Responses

All responses are JSON with a `request_id` (also in the `X-Request-Id` header). Every request after authentication is recorded in `integration_events` and shown on **Incoming Jobs**.

| Status | `status` / `error.code` | Meaning |
| --- | --- | --- |
| `201` | `created` | Job stored. Body has `job_id`, `reference`, `job_status`, `destinations`, `routing` (`explicit` or `awaiting_routing`), `warnings` |
| `200` | `duplicate` | The same job (same organisation + source + external ID, same content) was already received. Nothing changed. **Safe retry** |
| `409` | `duplicate_external_job` | Same organisation + source + external ID, but **different content**. Not applied. Edit the job in JobSync instead |
| `400` | `invalid_json` | Body is not JSON |
| `401` | `unauthorized` | Missing, malformed, unknown, revoked or expired key |
| `403` | `forbidden` / `source_not_allowed` | Key lacks the `jobs:intake` scope, or the source is not allowed for it |
| `413` | `payload_too_large` | Body over 1 MiB |
| `415` | `unsupported_media_type` | Not `application/json` |
| `422` | `validation_failed` | `error.issues` lists `{ path, message }` for every problem |
| `429` | `rate_limited` | Honour `Retry-After` |
| `500` | `internal_error` | Not stored. Safe to retry |
| `503` | `not_configured` / `unavailable` | Server not configured, or the database is unreachable |

### Idempotency

Duplicates are detected per **organisation + source + external job ID** by a database unique constraint, so concurrent retries cannot create two jobs. Two organisations can each have a job with the same external ID. Retrying after a timeout is always safe: you get `201` once, then `200 duplicate`.

### Rate limits

- 60 requests per minute per client IP, a first filter in memory on each server instance.
- 120 requests per minute per API key, the authoritative limit, enforced in Postgres (`public.consume_rate_limit`) and shared across instances.

At about 100 jobs a day these limits leave ample headroom.

## Example

```bash
curl -sS -X POST "$JOBSYNC_URL/api/v1/jobs/intake" \
  -H "Authorization: Bearer $JOBSYNC_API_KEY" \
  -H "Content-Type: application/json" \
  -d @job.json
```

## Requirements

The server needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The intake route uses the service role because the caller is a machine authenticated by API key, not a signed-in user. Without them the endpoint returns `503 not_configured`.
