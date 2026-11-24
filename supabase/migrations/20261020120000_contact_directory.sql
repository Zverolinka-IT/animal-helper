-- Versioned, administrator-reviewed public contacts. No case locations or
-- reporter data are stored here. Publications snapshot an immutable release.
create table ah.contact_directory_draft (
  jurisdiction text primary key check (jurisdiction = 'SK'),
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into ah.contact_directory_draft (jurisdiction, document)
values ('SK', '{"schemaVersion":1,"jurisdiction":"SK","entries":[]}'::jsonb);

create table ah.contact_directory_revisions (
  revision_id uuid primary key,
  jurisdiction text not null check (jurisdiction = 'SK'),
  document jsonb not null,
  published_at timestamptz not null,
  published_by text not null
);

alter table ah.guidance_revisions
  add column directory_revision_id uuid references ah.contact_directory_revisions (revision_id);

create table ah.contact_directory_commands (
  command_id uuid primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  operator_email text not null,
  accepted_at timestamptz not null
);

alter table ah.contact_directory_draft enable row level security;
alter table ah.contact_directory_revisions enable row level security;
alter table ah.contact_directory_commands enable row level security;

do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on ah.contact_directory_draft, ah.contact_directory_revisions, ah.contact_directory_commands from %I', role_name);
    end if;
  end loop;
end
$$;
