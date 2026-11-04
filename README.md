# JobSync: Multi-Portal Browser Automation Platform

JobSync receives maintenance work orders from an external job-management system (originally AroFlo), validates and stores them, routes each job to one or more of five client portals that have **no API**, and drives a Playwright browser worker to submit the work order into each portal. It tracks every confirmation, retry, failure and human intervention.

> **Status: Phases 1–2 of 8 implemented** (Phase 2 awaiting review). Foundation, overview dashboard, the full Supabase schema with versioned migrations, authentication, role-based access control and the Jobs module. The migrations are tested against real PostgreSQL; **no live Supabase project has been connected yet**, so the running app shows a setup screen until credentials are provided. See [docs/database.md](docs/database.md) and [Build phases](#build-phases).

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
- **Every page requires sign-in.** `src/proxy.ts` guards all pages and APIs, the data access layer re-checks the user before each read, and Row Level Security enforces access in the database.
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
    (auth)/                 # Public pages: login, setup, auth error
    (dashboard)/            # Signed-in app shell: sidebar + top bar
      page.tsx              # Overview dashboard (auto-refresh every 30 s)
      jobs/                 # Jobs list (search, filters, sort, pagination) and jobs/[id] detail
      account/password/     # Set or change password
      incoming/ jobs/new/ portals/ queue/ executions/
      failed/ analytics/ settings/integrations/ audit/ settings/system/
    auth/confirm/route.ts   # Invitation / password-recovery email links
    api/health/route.ts     # Liveness + configuration probe (public)
  proxy.ts                  # Route protection (Next.js 16 "proxy", formerly middleware)
  components/
    ui/                     # shadcn/ui primitives
    layout/                 # Sidebar, mobile drawer, top bar, execution-mode badge, user menu
    auth/                   # Login and password forms
    jobs/                   # Jobs filters, table, badges, archive button
    common/                 # PageHeader, StatusBadge, EmptyState, DataStateNotice, PhasePlaceholder
    dashboard/              # KPI tiles, chart frame (legend + table view), charts
  lib/
    domain/                 # Portals, job/task/execution statuses (single source of truth)
    metrics/                # Pure metric computation + labelled sample dataset (unit-tested)
    auth/                   # Permissions matrix, route rules, session/DAL, server actions
    jobs/                   # Jobs URL query parsing (allow-listed, unit-tested)
    data/                   # Server-only Supabase reads returning a typed DataResult
    supabase/               # Session client (RLS), proxy session refresh, service-role client
    env.ts                  # Zod-validated server environment (server-only)
    charts/palette.ts       # CVD-validated chart colour roles
supabase/
  migrations/               # Versioned, additive SQL migrations (8 files)
  tests/supabase-shim.sql   # Supabase roles/auth/storage stand-ins for local PostgreSQL tests
tests/db/                   # Database integration tests (real PostgreSQL)
docs/database.md            # Schema, roles, setup and verification status
```

Planned top-level additions: `worker/` (the Playwright controller as a separate package, Phase 5) and `docs/n8n/` (Phase 6).

## Getting started

```bash
npm install
cp .env.example .env.local   # add Supabase credentials (docs/database.md)
npm run dev                  # http://localhost:3000
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests; database tests too when `JOBSYNC_TEST_DATABASE_URL` is set |
| `npm run test:db` | Database integration tests against real PostgreSQL |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |
| `npm run lint` | ESLint |

Useful URLs: `/` (overview), `/?preview=sample` (labelled sample preview), `/jobs`, `/login`, `/setup`, `/api/health` (configuration probe).

Without Supabase credentials every page redirects to `/setup`. For UI work without a project, run `JOBSYNC_DEV_AUTH_BYPASS=true npm run dev`: sign-in is skipped in local development only.

### Environment variables

See [`.env.example`](.env.example). Missing values produce explicit *not configured* states; without the Supabase URL and anon key, sign-in (and so every page) is unavailable.

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (anon key used with RLS for user sessions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Trusted server reads/writes. **Never expose to the browser.** |
| `JOBSYNC_EXECUTION_MODE` | `dry_run` (default) or `live` |
| `JOBSYNC_ALLOW_LIVE_SUBMISSIONS` | Must be `true` before any LIVE submission is permitted |
| `JOBSYNC_MAX_CONCURRENCY` | Browser workers (default 3, max 10) |
| `JOBSYNC_DEV_AUTH_BYPASS` | `true` skips sign-in in `next dev` only, when Supabase is not configured |
| `JOBSYNC_TEST_DATABASE_URL` | PostgreSQL superuser URL for `npm run test:db` |

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
| 2 | Supabase schema & versioned migrations, RLS, authentication & roles, Jobs module | ✅ Implemented, awaiting review |
| 3 | Manual Create Job form and job editing, `POST /api/v1/jobs/intake` (auth, validation, idempotency, rate limit), Incoming Jobs | Planned |
| 4 | Routing engine (rules + reasons + human-review fallback), Portal Management (5 portals) | Planned |
| 5 | Automation queue (per-portal tasks, concurrency 3, backoff, locks, idempotency keys), Playwright worker & adapters | Planned |
| 6 | n8n intake & results webhooks (shared-secret/HMAC), result processing, Integration Settings with real tests | Planned |
| 7 | Execution history & timeline, audit logs, analytics | Planned |
| 8 | Sample-job generator (≤100 jobs, invalid/duplicate cases), end-to-end dry runs against the five demo portals | Planned |

### Data model

See [docs/database.md](docs/database.md) for every table, constraint, role and policy, and for the setup steps.

## What requires credentials or infrastructure

| Item | Needed from you | Without it |
| --- | --- | --- |
| Supabase project | URL, anon key, service-role key; apply migrations; invite users and promote an admin ([guide](docs/database.md)) | Every page redirects to `/setup` |
| n8n | Webhook URL + shared secret (Phase 6) | Intake API still usable directly |
| AroFlo | Authorised credentials and an approved integration method | Intake accepts AroFlo-shaped payloads via API/n8n only. **No direct AroFlo integration is claimed** |
| Demo portals | Network access to `jobsync-portal-tracker.lovable.app` from the worker host | The development sandbox used to build Phase 1 blocks this host, so Playwright runs must happen where it is reachable |
| LIVE mode | Explicit authorisation plus portal credentials stored server-side | Everything runs in DRY_RUN |

The five portals (Northstar, BluePeak, Greenfield, Apex, MetroCare) at `https://jobsync-portal-tracker.lovable.app/portal/<slug>` are **simulated demonstration portals**, not production customer systems.
