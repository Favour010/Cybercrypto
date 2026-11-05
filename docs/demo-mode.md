# JobSync demo data layer

JobSync runs on one of two data layers, chosen on the server with `JOBSYNC_DATA_MODE`:

| Mode | When | Data |
| --- | --- | --- |
| `demo` (default) | Until Supabase is migrated and verified | Realistic seeded data stored **in each visitor's own browser** (IndexedDB). No sign-in, no keys, no external services. |
| `supabase` | After `docs/database.md` setup | The Supabase implementation (sign-in, Row Level Security, intake API). |

Every page shows a "Demo data" badge and notice in demo mode. Nothing in demo mode reads or writes the Supabase database.

## What is real and what is simulated

| Area | In demo mode |
| --- | --- |
| Business rules (duplicates, routing, edit locks, retries, permissions) | **Real.** One engine (`src/lib/demo/engine.ts`) mirrors the SQL functions and is unit-tested |
| Validation | **Real.** The same Zod schemas as the server and intake API |
| Attachments | **Real files**, stored in the browser (type detected from content, size limits) |
| Portal connection test | **Real** HTTPS request from the server, limited to allow-listed hosts (`JOBSYNC_PORTAL_TEST_HOSTS`) and public IP addresses |
| n8n / controller test buttons | **Real** HTTPS request with a fixed test payload (SSRF-guarded, rate-limited) |
| Portal submissions | **Simulated dry runs.** No browser is opened and no portal is contacted. Every execution is labelled *Simulated*; a passed run is shown as *Dry run passed*, never as *Submitted* |
| Manual submissions | Recorded when a person enters the portal's reference; labelled *Submitted manually* |
| Intake API (`POST /api/v1/jobs/intake`) | Returns `503 demo_mode`. The intake simulator on Incoming Jobs applies the same validation and duplicate rules |
| Outbound n8n events | Recorded, **not delivered** ("Not sent (demo)") |
| n8n shared secret | **Not stored.** Only "configured" and the last 4 characters |
| Sign-in | None. A demo user menu switches between Admin, Operator and Viewer to show role permissions |

## Modules

| Module | Features |
| --- | --- |
| Overview | 12 KPIs, 5 charts, worker status, items needing attention |
| Jobs | Database-style search, filters, sort, pagination; detail page with contacts, attachments, destinations, per-portal actions, executions, audit trail; archive and restore |
| Create Job / Edit Job | Shared form; attachments; explicit destinations; double-submit protection; edit locks and acknowledgement after submission |
| Incoming Jobs | Newly received, validated, duplicates, rejected, import errors, awaiting routing; intake simulator; sample generator (≤100 jobs with invalid and duplicate payloads); run routing |
| Portal Management | Five portal cards; per-portal configuration, real connection test, statistics, form-field mapping, recent failures; routing rules (add, edit, pause, delete) and a rule tester |
| Automation Queue | Simulated worker (start/pause), concurrency slots, per-portal locks, status filters, search, retry, escalate, cancel, record manual submission |
| Execution History | Filterable list; detail with step timeline, result, duration, error and all attempts for the submission |
| Failed Jobs | Human review (including jobs no rule matched), failed tasks with bulk retry, scheduled retries |
| Analytics | 7/14/21-day reports: intake, attempts, success by portal, failure reasons, workload by weekday, timings; CSV export |
| Integration Settings | Data source status, intake API details, n8n outbound settings and test, Playwright controller URL and test, outbound event log |
| Audit Logs | Every change with actor and before/after values; filters; CSV export; admin only |
| System Configuration | Execution mode (dry run; live disabled with reason), concurrency, retries, backoff, timeout, polling, auto-routing, simulation settings; export JSON; reset demo data |

## Not built yet

- **The real Playwright worker and portal adapters.** The repository contains no Playwright automation scripts. `src/lib/portals/specs.ts` describes each portal's form fields and steps for when they are built.
- Supabase backends for Portal Management, Automation Queue, Execution History, Failed Jobs, Analytics, Integration Settings, Audit Logs and System Configuration. In Supabase mode these pages say so instead of showing data.
- Server-side n8n delivery and encrypted secret storage.

## Testing

```bash
npm test                     # unit tests, incl. the demo engine
npm run build && npm start   # then, in another terminal:
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

The end-to-end suite needs the `playwright` package and a Chromium browser.
