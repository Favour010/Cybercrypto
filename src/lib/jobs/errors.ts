/** Human messages for the SQLSTATE codes raised by the job functions (migration 0011). */
export const JOB_DB_ERRORS: Record<string, string> = {
  JSU01: "One of the selected destination portals does not exist.",
  JSU02: "One of the selected destination portals is disabled. Choose a different portal.",
  JSU03: "Someone else changed this job while you were editing. Reload the page to see their changes, then try again.",
  JSU04: "A portal submission for this job has started, so this change is not allowed.",
  JSU05: "Your role does not permit this action.",
  JSU06: "Job not found.",
  JSU07: "This job has already been submitted to at least one portal. Confirm that your edits will not be re-sent.",
  JSU08: "Archived jobs cannot be edited. Restore the job first.",
  JSU09: "An attachment was stored in an unexpected location. Remove it and upload it again.",
};

export function jobDbErrorMessage(
  code: string | undefined,
  fallback = "The job could not be saved. Try again.",
): string {
  return (code && JOB_DB_ERRORS[code]) || fallback;
}
