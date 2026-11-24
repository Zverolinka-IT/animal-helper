-- Additive metadata. Apply before deploying the API that reads these columns.
-- Existing publications omit clinic_variant and retain their original hashes.
-- Roll back application code if needed; retain the columns and reviewed data.
alter table ah.audit_events add column target_operator_id uuid;

alter table ah.guidance_cells add column clinic_variant text
  check (clinic_variant in ('standard', 'protected'));

comment on column ah.audit_events.target_operator_id is
  'Account affected by an administrator permission change; separate from case stream_id';
