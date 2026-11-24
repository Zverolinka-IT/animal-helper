-- Serialised, optimistic admin writes and idempotent command receipts.
-- Receipts contain no working notes or other private command contents.
-- Recovery: roll forward; keep receipts while clients may retry commands.
alter table ah.admin_case_work
  add column revision integer not null default 0 check (revision >= 0);

create table ah.admin_case_commands (
  command_id uuid primary key,
  stream_id uuid not null references ah.streams (stream_id),
  actor_reference text not null,
  content_hash bytea not null,
  committed_revision integer not null check (committed_revision > 0)
);

alter table ah.admin_case_commands enable row level security;
