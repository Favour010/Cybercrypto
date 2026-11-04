-- JobSync · 0008 · Private storage bucket for job attachments
--
-- Object paths are "<organisation_id>/<job_id>/<file>". Users can read files
-- in their organisation's folder; operators can upload. The bucket is private:
-- files are served through short-lived signed URLs only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-attachments',
  'job-attachments',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain']
)
on conflict (id) do nothing;

create policy job_attachments_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = public.current_organisation_id()::text
  );

create policy job_attachments_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-attachments'
    and (storage.foldername(name))[1] = public.current_organisation_id()::text
    and public.has_min_role('operator')
  );
