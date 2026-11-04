# JobSync database, authentication and access control

Phase 2 delivers the Supabase schema, versioned migrations, authentication, role-based access control and the Jobs module.

## Verification status

| What | Status |
| --- | --- |
| Migrations apply cleanly, in order, to PostgreSQL 16 | ✅ Tested (`npm run test:db`, 32 tests) |
| Constraints, triggers, audit log, Row Level Security, Storage policies | ✅ Tested on real PostgreSQL with Supabase's roles and `auth.uid()` reproduced by `supabase/tests/supabase-shim.sql` |
| Every column the dashboard reads exists | ✅ Tested against `src/lib/data/overview-contract.ts` |
| Proxy / route protection, login form, dev-bypass refusal in production | ✅ Tested against the production build |
| **A live Supabase project** (Auth, PostgREST, Storage) end to end | ❌ **Not tested.** No project credentials were available. The supabase-js queries in `src/lib/data/*` are type-checked and built, but have not run against PostgREST |

## Schema

Migrations live in `supabase/migrations/` and are **additive only**: no `DROP`, `TRUNCATE` or `DELETE` (a test enforces this). Seed rows use `ON CONFLICT DO NOTHING`.

| Migration | Contents |
| --- | --- |
| `…0100_types_and_helpers` | Enums mirroring `src/lib/domain/status.ts`; `set_updated_at()` |
| `…0200_core_tables` | `organisations`, `profiles`, `portals` (+ default organisation and the five demo portals, `connection_status = 'untested'`) |
| `…0300_jobs` | `jobs`, `job_contacts`, `job_attachments` |
| `…0400_routing_and_queue` | `routing_rules`, `job_portal_assignments`, `submission_tasks`, `automation_executions` |
| `…0500_integrations_and_audit` | `integration_settings`, `integration_events`, `audit_logs` + audit triggers |
| `…0600_row_level_security` | Role helpers, grants, RLS policies |
| `…0700_auth_profiles` | Profile creation for new Supabase Auth users |
| `…0800_storage` | Private `job-attachments` bucket and its policies |

### Tables

| Table | Purpose | Key rules |
| --- | --- | --- |
| `organisations` | Tenant boundary | Unique `slug` |
| `profiles` | One per `auth.users` row: organisation, role, active flag | New users are `viewer` |
| `portals` | The five client portals | Unique, **immutable** `slug`; never "connected" without a recorded test |
| `jobs` | Work orders | **Unique `(source, external_job_id)`**; external jobs must have an external ID; reference `JS-000123`; archived, never deleted |
| `job_contacts` | Contact people | One primary contact per job |
| `job_attachments` | Files in Storage or HTTPS URLs | 25 MB limit, unique storage path |
| `routing_rules` | Configurable routing conditions → portal | At least one condition |
| `job_portal_assignments` | Routing decision per job and portal | **Unique `(job_id, portal_id)`**, `reason` required |
| `submission_tasks` | One task per assignment | **Unique `(job_id, portal_id)`** and unique `idempotency_key` (`<job_id>:<portal_slug>`); `submitted` is final; a LIVE `submitted` needs a confirmation reference |
| `automation_executions` | One row per browser attempt | Unique `(task_id, attempt)`; job/portal copied from the task; `duration_ms` computed |
| `integration_settings` | Per-organisation integration config | Ciphertext column unreadable by users |
| `integration_events` | Inbound/outbound integration messages | Written by the server only |
| `audit_logs` | Change history | Append-only (UPDATE/DELETE/TRUNCATE blocked) |

`portal_slug` on tasks and executions is guarded by a composite foreign key to `portals (id, slug)`, so it cannot disagree with `portal_id`.

### Columns the dashboard depends on

| Table | Columns |
| --- | --- |
| `jobs` | `status`, `source_type`, `received_at`, `archived_at` |
| `submission_tasks` | `portal_slug`, `status`, `execution_mode`, `created_at`, `completed_at` |
| `automation_executions` | `status`, `mode`, `worker_id`, `started_at`, `completed_at` |

## Roles and access

| Capability | viewer | operator | admin |
| --- | :-: | :-: | :-: |
| Read jobs, tasks, executions, dashboards | ✅ | ✅ | ✅ |
| Create, edit, archive jobs; contacts, attachments, assignments | | ✅ | ✅ |
| Read integration events | | ✅ | ✅ |
| Manage portals, routing rules, users and roles | | | ✅ |
| Read integration settings (never the secret) and audit logs | | | ✅ |

- Users only ever see rows in **their own organisation**; deactivated users see nothing.
- `anon` has no table access.
- `submission_tasks`, `automation_executions`, `integration_events` and integration secrets are written only by trusted server code with the **service-role key**, which never leaves the server (`server-only` modules).
- The same matrix is in `src/lib/auth/permissions.ts` for UI and server-action checks; the database enforces it independently.

### How requests are protected

1. **`src/proxy.ts`** runs before every page and API route. Signed-out visitors are redirected to `/login?next=…`; API routes return `401` JSON. Without Supabase configuration, pages redirect to `/setup` and APIs return `503`. Sessions are validated with `getClaims()`, not read blindly from cookies.
2. **`src/lib/auth/session.ts`** (data access layer) re-verifies the user with `supabase.auth.getUser()` and loads the profile before any data is read. Pages call `requireUser()`; server actions call `authorize(permission)`.
3. **Row Level Security** in the database is the final authority.

`/api/v1/*` is reserved for machine-to-machine APIs (Phase 3+). Handlers there must authenticate every request themselves (API key / HMAC).

**Development bypass.** `JOBSYNC_DEV_AUTH_BYPASS=true` skips sign-in only when `NODE_ENV=development` **and** Supabase is not configured. It is ignored by `next build`/`next start`, and the UI labels it clearly.

## Setting up a Supabase project

1. **Create a project** at supabase.com.
2. **Apply the migrations**, either with the Supabase CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   or by running each file in `supabase/migrations/` in filename order in the SQL editor.
3. **Configure Auth** (Authentication → Settings):
   - Turn **off** "Allow new users to sign up". Users are invited.
   - Set the **Site URL** to your JobSync URL.
   - In the **Invite user** and **Reset password** email templates, link to the confirm route:
     ```
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
     ```
4. **Environment variables** (`.env.local` or your host):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   SUPABASE_SERVICE_ROLE_KEY=<service-role key>   # server only, needed from Phase 3
   ```
5. **Invite users** (Authentication → Users → Invite). Each gets a `viewer` profile in the default organisation.
6. **Promote the first administrator** in the SQL editor:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   Admins can then change roles. Operators: `role = 'operator'`.

**Additional organisations.** Insert into `public.organisations`, then set `app_metadata.organisation_slug` on the user with the Auth admin API before or when inviting them. `user_metadata` is user-editable and is deliberately ignored.

## Testing the schema locally

The database tests create a throwaway database, apply the shim and every migration, and run assertions as the `anon`, `authenticated` and `service_role` roles. They need any PostgreSQL 14+ server and a superuser URL:

```bash
JOBSYNC_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:db
```

Without `JOBSYNC_TEST_DATABASE_URL` the database suite is skipped and `npm test` runs the unit tests only.

## Notes for later phases

- **Phase 3 (intake):** insert jobs with the service role, record each request in `integration_events`, and rely on the `(source, external_job_id)` unique key for idempotency (`on conflict do nothing` → report `duplicate`).
- **Phase 5 (queue):** claim tasks with `status in ('pending','retry_scheduled') and next_attempt_at <= now()` (indexed), skip jobs where `archived_at is not null`, and pass `idempotency_key` to the portal adapter.
- **Phase 6 (settings):** encrypt secrets with AES-256-GCM using a server key before writing `secret_ciphertext`; store only a short `secret_hint`.
