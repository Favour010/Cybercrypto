/** Attachment limits shared by the browser form and server validation (no Node APIs). */
export const ATTACHMENT_BUCKET = "job-attachments";
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB per file
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MiB per submission
export const ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.pdf,.txt";
