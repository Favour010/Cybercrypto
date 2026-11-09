# Upstream work orders and batches

Migration `20261109001200_upstream_work_orders.sql` adds the central work-order store to the same Supabase project as JobSync.

```
upstream_batches / upstream_work_orders   (Supabase, this migration)
  → n8n                                   (database role jobsync_upstream_n8n)
  → POST /api/v1/jobs/intake              (JobSync API key)
  → JobSync validation, deduplication, routing, queue
  → Playwright → Northstar, BluePeak, Greenfield, Apex, MetroCare
```

The upstream tables are separate from JobSync's `jobs` table. n8n has **no privileges on any JobSync table**. It can read the two upstream tables and call three functions. Jobs reach JobSync only through the API, so every work order gets the same validation, duplicate rules and routing as any other source.

## Tables

| Table                  | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream_batches`     | One row per batch (about 100 records, at most 1000). Unique `(organisation_id, batch_reference)`. Counters `total_count`, `pending_count`, `in_progress_count`, `delivered_count` and `failed_count` are kept by triggers. `status` is `open`, `completed` or `completed_with_failures`, and `completed_at` is set when nothing is left to deliver.                                                                                                                           |
| `upstream_work_orders` | One row per work order: a stable `id`, its `batch_id`, the source system's `external_job_id`, the exact API `payload`, and `delivery_status` (`pending`, `in_progress`, `delivered` or `failed`). It also holds the attempt count, the lease and the last API response. Unique `(organisation_id, source, external_job_id)`, which is the same key JobSync deduplicates on. A delivered record is final and links to its JobSync job (`jobsync_job_id`, `jobsync_reference`). |

## Functions

| Function                                                                                                            | Who                            | What                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `upstream_enqueue_work_orders(batch_reference, source, work_orders[, label, organisation_id])`                      | n8n, service role              | Adds 1–500 records to a batch, creating the batch if needed. Idempotent: existing records are reported as `duplicates` (same payload) or `conflicts` (different payload, nothing changed). |
| `upstream_claim_work_orders(worker[, limit, lease_seconds, batch_id])`                                              | n8n, service role              | Leases up to `limit` due records. Concurrent n8n executions never get the same record.                                                                                                     |
| `upstream_report_delivery(work_order_id, claim_token, http_status[, response, error_message, retry_after_seconds])` | n8n, service role              | Records the API answer (see below).                                                                                                                                                        |
| `upstream_requeue_work_orders([batch_id, work_order_ids])`                                                          | service role / SQL editor only | Puts failed records back in the queue with fresh attempts. Audited.                                                                                                                        |

## The n8n workflow

1. Get records into the store: call `upstream_enqueue_work_orders`, or insert rows another way as `postgres` or the service role.
2. On a schedule, call `upstream_claim_work_orders('n8n', 25)`.
3. For each returned row, `POST` its `payload` to `/api/v1/jobs/intake` with the JobSync API key. The key must belong to the same organisation as the record and allow its source.
4. Call `upstream_report_delivery(work_order_id, claim_token, <HTTP status>, <response body>)`. If there was no response at all, pass `null` as the status. For `429`, pass the `Retry-After` value.

| API answer                                         | Result                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `201 created`, `200 duplicate`                     | `delivered`, linked to the JobSync job                                                                                                              |
| no response, `408`, `425`, `429`, `5xx`            | back to `pending` with backoff (30 s × 2^(attempt−1), capped at 1 h, or longer if the server asked) until `max_attempts` (default 5), then `failed` |
| `400`, `401`, `403`, `409`, `413`, `415`, `422`, … | `failed`. A person fixes the cause (payload, API key, conflicting job), then requeues                                                               |

### Why retries are safe

- **Lost reports.** If n8n stops after posting but before reporting, the lease expires and the record is claimed again. JobSync answers `200 duplicate` for the job it already holds, so it is never created twice.
- **Stale reports.** A report carrying an old `claim_token` is ignored. Reporting again after delivery changes nothing.
- **Trusted job link.** A success answer is only accepted if its `job_id` really is this record's job: same organisation, source and external ID.

## n8n login

The deployment creates `jobsync_upstream_n8n` without a login. Create the login separately, with a password you choose:

```sql
create role jobsync_n8n_login with login password '<a long random password>' in role jobsync_upstream_n8n;
```

Connect n8n's Postgres node as that user. Through the Supabase pooler the user name is `jobsync_n8n_login.<project-ref>`. **Never** give n8n the service-role key or the `postgres` password: those can write to JobSync's tables directly.
