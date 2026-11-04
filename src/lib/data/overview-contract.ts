/**
 * The exact columns the overview dashboard reads from each table.
 *
 * The database integration tests (tests/db) run these selects against the
 * migrated schema, so a migration that renames or drops any of these columns
 * fails the test suite instead of silently breaking the dashboard.
 */
export const OVERVIEW_QUERY_CONTRACT = {
  jobs: {
    table: "jobs",
    columns: "status, source_type, received_at",
    timeColumn: "received_at",
    /** Archived jobs are excluded from every overview figure. */
    activeFilterColumn: "archived_at",
  },
  submissionTasks: {
    table: "submission_tasks",
    columns: "portal_slug, status, execution_mode, created_at, completed_at",
    timeColumn: "created_at",
  },
  automationExecutions: {
    table: "automation_executions",
    columns: "status, mode, worker_id, started_at, completed_at",
    timeColumn: "started_at",
  },
} as const;
