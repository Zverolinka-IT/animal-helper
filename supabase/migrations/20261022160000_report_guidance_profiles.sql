-- Add reviewed routing profiles to the existing immutable guidance publication.
-- Existing revisions retain their original hashes: an empty profile list is
-- omitted from the canonical document. Recovery: leave the additive column in
-- place and deploy the previous application version; no existing data changes.
alter table ah.guidance_revisions
  add column report_profiles jsonb not null default '[]'::jsonb
  check (jsonb_typeof(report_profiles) = 'array');
