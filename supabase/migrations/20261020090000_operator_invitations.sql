-- Additive account-management permission and invitation metadata.
-- Existing operators remain ordinary admins until explicitly granted permission.
-- Recovery: roll forward; old code ignores these columns.
alter table ah.operators
  add column can_manage_operators boolean not null default false;

alter table ah.operator_bootstraps
  add column invitation_id uuid not null default gen_random_uuid() unique,
  add column created_at timestamptz not null default now(),
  add column issued_by uuid references ah.operators (operator_id) on delete set null;

create index ah_operator_bootstraps_issuer_created_idx
  on ah.operator_bootstraps (issued_by, created_at);

-- A reauthentication challenge belongs to the initiating session, while
-- ordinary sign-in challenges have no session binding.
alter table ah.operator_challenges
  add column session_token_hash bytea
    check (session_token_hash is null or octet_length(session_token_hash) = 32);
