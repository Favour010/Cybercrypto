# JobSync: Multi-Portal Browser Automation Platform

JobSync receives maintenance work orders from an external job-management system (originally AroFlo), validates and stores them, routes each job to one or more of five client portals that have **no API**, and drives a Playwright browser worker to submit the work order into each portal. It tracks every confirmation, retry, failure and human intervention.

> **Status: Phase 1 of 8 complete.** The application foundation, design system, navigation and the overview dashboard are implemented. The dashboard reads real database records (no Supabase project is connected yet, so it truthfully shows *Database not connected*). See [Build phases](#build-phases).

```
External source ──► Secure intake API ──► Supabase ──► Validation & routing ──► Automation queue
     (AroFlo/n8n)        (idempotent)                                         (1 task per portal)
                                                                                     │
  Analytics & audit ◄── Results tracking ◄── Confirmation capture ◄── Playwright worker ──► 5 portals
```

## Honesty rules this codebase enforces

- **No invented statistics.** Every dashboard number comes from database rows. With no database, tiles show `—` (not `0`) and a *Database not connected* notice explains what is missing.
- **Sample data is always labelled.** `/?preview=sample` renders a deterministic, in-memory dataset behind a *Sample data preview: not production statistics* banner. It is never written to the database.
- **"Configured" ≠ "connected".** Integrations are only reported as connected after a real, recorded connection test (Phase 6). Saving a portal URL never marks it connected.
- **DRY_RUN is the default.** LIVE submission requires `JOBSYNC_EXECUTION_MODE=live` **and** `JOBSYNC_ALLOW_LIVE_SUBMISSIONS=true`. The current mode is shown in the top bar on every page.
- **Dry-run results are never shown as real submissions.** Metrics prefer live results and label dry-run figures explicitly.
- **Secrets stay server-side.** `src/lib/env.ts` and the Supabase admin client import `server-only`, so importing them from browser code fails the build.

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router, Cache Components), React 19, TypeScript, Tailwind CSS v4, shadcn/ui (Radix), Lucide, Recharts |
| Backend | Next.js route handlers & server components; Zod validation |
| Data | Supabase Postgres + Storage, Row Level Security (Phase 2) |
| Automation | Separate Playwright (TypeScript) worker with one adapter per portal (Phase 5) |
| Orchestration | n8n webhooks in both directions (Phase 6); the core API works without n8n |
| Tests | Vitest (unit), Playwright (end-to-end, Phase 8) |

> **Next.js 16 notes:** request APIs (`params`, `searchParams`, `cookies`) are async-only. Route protection uses `proxy.ts` (the renamed middleware). With Cache Components, per-request reads live inside `<Suspense>`. Version-matched docs ship in `node_modules/next/dist/docs/`.

## Project structure

```
src/
  app/
    (dashboard)/            # Authenticated app shell: sidebar + top bar
      page.tsx              # Overview dashboard (Phase 1)
      jobs/ incoming/ jobs/new/ portals/ queue/ executions/
      failed/ analytics/ settings/integrations/ audit/ settings/system/
    api/health/route.ts     # Liveness + configuration probe
  components/
    ui/                     # shadcn/ui primitives
    layout/                 # Sidebar, mobile drawer, top bar, execution-mode badge
    common/                 # PageHeader, StatusBadge, EmptyState, DataStateNotice, PhasePlaceholder
    dashboard/              # KPI tiles, chart frame (legend + table view), charts
  lib/
    domain/                 # Portals, job/task/execution statuses (single source of truth)
    metrics/                # Pure metric computation + labelled sample dataset (unit-tested)
    data/                   # Server-only Supabase reads returning a typed DataResult
    supabase/admin.ts       # Service-role client (server-only)
    env.ts                  # Zod-validated server environment (server-only)
    charts/palette.ts       # CVD-validated chart colour roles
```

Planned top-level additions: `supabase/migrations/` (Phase 2), `worker/` (the Playwright controller as a separate package, Phase 5), and `docs/n8n/` (Phase 6).

## Getting started

```bash
npm install
cp .env.example .env.local   # optional: the app runs without any credentials
npm run dev                  # http://localhost:3000
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

Useful URLs: `/` (overview), `/?preview=sample` (labelled sample preview), `/api/health` (configuration probe).

### Environment variables

See [`.env.example`](.env.example). All are optional at boot. Missing values produce explicit *not configured* states.

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (anon key used with RLS for user sessions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted server reads/writes. **Never expose to the browser.** |
| `JOBSYNC_EXECUTION_MODE` | `dry_run` (default) or `live` |
| `JOBSYNC_ALLOW_LIVE_SUBMISSIONS` | Must be `true` before any LIVE submission is permitted |
| `JOBSYNC_MAX_CONCURRENCY` | Browser workers (default 3, max 10) |

## Overview dashboard: metric definitions

| Tile | Definition |
| --- | --- |
| Total jobs received | Non-archived jobs |
| Awaiting processing | Jobs in `received`, `validating` or `ready` |
| Currently processing | Jobs in `processing` |
| Successfully submitted | Jobs in `submitted`; hint splits live portal submissions vs dry-run rehearsals |
| Partially submitted / Requires human review / Failed jobs | Jobs in those statuses |
| Success rate | Finished tasks (`submitted`, `failed`, `human_review`) in the last 14 days that were submitted. Live preferred; dry-run only when no live results exist, and labelled |
| Failed submissions | Submission tasks in `failed` |
| Active browser workers | Distinct `worker_id` with a `running` execution |
| Queue backlog | Tasks in `pending` or `retry_scheduled` |
| Average submission time | Mean duration of successful executions in the last 14 days (live preferred) |

Charts cover the last 14 UTC days: job intake by source, outcomes by portal, workload by portal, job processing trend, and daily automation activity by execution mode. Each chart has a legend and an accessible **table view** of the exact plotted numbers. Status colours are ordered green → amber → red so red never sits next to green (colour-blind safe), and status is always paired with a text label.

## Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation, design system, navigation, overview dashboard | ✅ Complete |
| 2 | Supabase schema & versioned migrations, RLS, authentication & roles, Jobs module | ⏳ Next |
| 3 | Manual Create Job form, `POST /api/v1/jobs/intake` (auth, validation, idempotency, rate limit), Incoming Jobs | Planned |
| 4 | Routing engine (rules + reasons + human-review fallback), Portal Management (5 portals) | Planned |
| 5 | Automation queue (per-portal tasks, concurrency 3, backoff, locks, idempotency keys), Playwright worker & adapters | Planned |
| 6 | n8n intake & results webhooks (shared-secret/HMAC), result processing, Integration Settings with real tests | Planned |
| 7 | Execution history & timeline, audit logs, analytics | Planned |
| 8 | Sample-job generator (≤100 jobs, invalid/duplicate cases), end-to-end dry runs against the five demo portals | Planned |

### Planned data model (Phase 2)

`organisations`, `users` (profiles + roles), `jobs` (unique `(source, external_job_id)`), `job_contacts`, `job_attachments` (Supabase Storage refs), `portals`, `routing_rules`, `job_portal_assignments` (unique `(job_id, portal_id)` and the routing reason), `submission_tasks` (one per assignment, idempotency key, attempt count, backoff schedule), `automation_executions` (one per attempt: mode, worker, timings, confirmation reference, screenshot), `integration_settings` (encrypted secrets, never returned raw), `integration_events`, `audit_logs`. All with UUID keys, foreign keys, indexes, timestamps and RLS. Migrations are additive and never delete data.

## What requires credentials or infrastructure

| Item | Needed from you | Without it |
| --- | --- | --- |
| Supabase project | URL, anon key, service-role key; apply migrations (Phase 2) | Dashboard shows *Database not connected* |
| n8n | Webhook URL + shared secret (Phase 6) | Intake API still usable directly |
| AroFlo | Authorised credentials and an approved integration method | Intake accepts AroFlo-shaped payloads via API/n8n only. **No direct AroFlo integration is claimed** |
| Demo portals | Network access to `jobsync-portal-tracker.lovable.app` from the worker host | The development sandbox used to build Phase 1 blocks this host, so Playwright runs must happen where it is reachable |
| LIVE mode | Explicit authorisation plus portal credentials stored server-side | Everything runs in DRY_RUN |

The five portals (Northstar, BluePeak, Greenfield, Apex, MetroCare) at `https://jobsync-portal-tracker.lovable.app/portal/<slug>` are **simulated demonstration portals**, not production customer systems.
