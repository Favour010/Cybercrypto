# Automation worker integration

JobSync does not drive browsers itself. A separate **automation worker** (to be
built with Playwright) takes one portal task at a time, fills that portal's
form and reports the result back. Today a **simulated worker** runs inside the
browser in demo mode and uses exactly the same contract, so the real worker can
replace it without changing the queue, the result processing or the UI.

> **Status.** The repository contains **no Playwright scripts or portal
> adapters yet**: none existed when this work started, so none were removed.
> Everything below describes the contract that is implemented and tested on
> the JobSync side, and what the worker will need to implement.

## The two messages

Defined in [`src/lib/automation/contract.ts`](../src/lib/automation/contract.ts).

```
JobSync ──AutomationTaskPayload──▶ worker     one job, one portal, one attempt
JobSync ◀──AutomationResult─────── worker     validated before it is applied
```

### AutomationTaskPayload (JobSync → worker)

| Field                                | Meaning                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_id`, `task_id`, `attempt` | Identify this attempt. The result must echo `execution_id` and `attempt`.                                                                                                                                 |
| `idempotency_key`                    | Same for every attempt of one job on one portal. The adapter must check the portal for an existing submission with this key (or the job's external ID) before submitting, so a retry never submits twice. |
| `execution_mode`                     | `dry_run` (fill and validate, never click submit) or `live`. Live requires server authorisation; the demo is always `dry_run`.                                                                            |
| `portal`                             | `slug`, `base_url`, `timeout_seconds`. **No credentials**: the worker reads them from its own secret store.                                                                                               |
| `job`                                | The job fields and primary contact the portal form needs.                                                                                                                                                 |
| `attachments`                        | References only (`id`, name, type, size, location). The worker downloads files itself.                                                                                                                    |

Every execution detail page shows the exact payload for that attempt
(_Task payload → Show JSON_).

### AutomationResult (worker → JobSync)

| Field                                                                         | Rule                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_id`, `job_id`, `portal`, `attempt`, `execution_mode`, `started_at` | Must match the execution JobSync started; otherwise the result is **rejected**. A result cannot change the execution mode.                            |
| `status`                                                                      | `dry_run_passed`, `submitted`, `failed` or `needs_review`.                                                                                            |
| `confirmation_reference`                                                      | Required for `submitted`; forbidden for `dry_run_passed`.                                                                                             |
| `error`                                                                       | `{ code, message, retryable }`, required for `failed`/`needs_review`, forbidden on success. Codes are `UPPER_SNAKE_CASE`.                             |
| `steps`                                                                       | Optional step timeline (`open_portal`, `fill_form`, `submit`, …).                                                                                     |
| `screenshot_url`                                                              | Optional evidence location.                                                                                                                           |
| `simulated`                                                                   | `true` when no real browser or portal was involved. A simulated result can never be `submitted`, and a demo execution only accepts simulated results. |

### How a result is applied

Implemented in `processAutomationResult` (`src/lib/demo/engine.ts`) and unit-tested:

| Result                                      | Task becomes                                        | Notes                                           |
| ------------------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `dry_run_passed`                            | `submitted` (mode stays `dry_run`)                  | Shown as **Dry run passed**, never as Submitted |
| `submitted` (live only)                     | `submitted` (mode `live`) with the portal reference |                                                 |
| `failed`, `retryable: true`, attempts left  | `retry_scheduled`                                   | Backoff = base × 2^(attempt − 1)                |
| `failed`, retryable, retry limit reached    | `failed`                                            |                                                 |
| `needs_review` or `retryable: false`        | `human_review`                                      | CAPTCHA, MFA, portal validation errors, …       |
| Same result posted again                    | unchanged — **duplicate**                           | Safe to retry delivery                          |
| Conflicting result for a finished execution | unchanged — **rejected**                            |                                                 |
| Any result for a task already submitted     | unchanged — **rejected**                            | JobSync never records a second submission       |

The job's status is then recomputed from all its portal tasks, an audit entry
is written, and — if n8n outbound events are enabled — an outbound event is
recorded (`task.dry_run_passed`, `task.submitted`, `task.failed`,
`task.needs_review`). In demo mode outbound events are recorded with their full
payload but **not delivered**.

## Trying it in the demo

_Integration Settings → Worker result simulator_ (admin):

1. **Start attempt** on a queued task. This opens an attempt that waits for an
   external result; the simulated worker will not finish it.
2. Pick a template (dry run passed, retryable failure, CAPTCHA, or an invalid
   "dry run claims a submission") or edit the JSON.
3. **Post result** and see it applied, ignored as a duplicate, or rejected with
   the reasons. Every post is logged under _Recent posted results_.

Nothing is sent over the network and no portal is contacted.

## What the real worker still needs

| Piece           | Needed                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Worker host     | A server (not Vercel functions) with Chromium and Playwright, network access to the portals                                     |
| Portal adapters | One per portal, following the field map and steps in `src/lib/portals/specs.ts`; stop at the submit step in dry run             |
| Task claiming   | Supabase-mode queue claim (row lock on `portal_tasks`, one running attempt per portal, concurrency limit)                       |
| Result endpoint | An authenticated server route (HMAC shared secret) that calls the same validation as `processAutomationResult` against Supabase |
| Credentials     | Portal credentials stored on the worker host only; never in the browser, the database payload, or this repository               |
| Limits          | Never bypass CAPTCHA or MFA (report `needs_review`); live submissions only with written authorisation for each portal           |
