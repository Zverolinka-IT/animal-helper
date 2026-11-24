# Migrations

`20261027190000_operator_roles_and_clinic_variants.sql` adds nullable metadata
columns for permission-change audit targets and reviewed W18/W19 veterinary
presentation choices. It takes brief schema locks without rewriting existing
rows. No report contents, tokens or email addresses are copied; audit target IDs
follow the existing audit retention policy. Apply before deploying the new API.
Existing publications retain their hashes when no variant is set. Recover by
rolling forward; keep the columns. Before reverting to an older API after a
variant-bearing publication, restore a verified earlier guidance publication
that the older parser can read.

Commit forward-only, reviewed SQL migrations here once the data model is
exercised by an integration test.

Each migration must document compatibility, locking/availability implications,
private-data and retention effects, and a roll-forward recovery path. Production
schema changes are never made manually through a dashboard.

The first migration creates schema `ah`: event stream, accepted commands,
erasable private records, capability hashes, projections, outbox, and audit.

`20261019180000_admin_case_commands.sql` adds workspace revisions and command
receipts. It takes a brief schema lock to add a defaulted integer column and
creates a new RLS-protected table; it does not copy private workspace contents.
Apply it before the updated admin API. Recovery is a forward migration; keep
receipts while clients can retry accepted requests. Reporter private-data purge
now also erases `ah.admin_case_work`.

Older workspace-only `closed` flags are not evidence of a completed event
stream. Reads use the authoritative completed/review state; an inconsistent old
closed workspace on a submitted stream appears passive for explicit operator
review. No completion events are fabricated during migration.

`20261020090000_operator_invitations.sql` adds a default-denied
account-management permission, opaque invitation IDs, issue timestamps/issuer
references, and a hashed session binding for passkey reauthentication. It
briefly locks the auth tables; assigning invitation UUIDs may rewrite the small
bootstrap table. No bearer tokens or private case contents are added. Apply it
before the new API; grant manager permission separately through trusted
maintenance. Existing operators, passkeys and sessions remain valid. Recovery is
a forward migration; retain the metadata and default-denied permission during an
application rollback.

`20261020120000_contact_directory.sql` creates an empty Slovak directory draft,
immutable releases and command receipts protected by RLS, with no direct public
access. It adds a nullable release reference to guidance revisions, requiring a
brief schema lock but no rewrite of guidance or case data. Existing publications
work without a directory and display unavailable contact states. No private data
or operational telephone numbers are seeded. Apply before the new API.
Publication and audit are transactional. Recovery is a forward migration; retain
historical releases and retry receipts. Older clients safely ignore the added
public field.

### Report guidance profiles

`20261022160000_report_guidance_profiles.sql` adds an empty-by-default JSONB
profile list to guidance revisions. Apply it before deploying the all-flow
admin/API changes. Existing publication hashes and injured cells are unchanged.
Profiles use the same immutable publication and optimistic draft-edit boundary;
directory publication also preserves them. Rollback leaves this additive column
in place rather than deleting published content.

The `ALTER TABLE` takes an exclusive schema lock; the array check validates
existing guidance revisions while holding it. The constant JSONB default does
not require rewriting the table on PostgreSQL 15+. Apply during low guidance
editing activity. No case events, private records, retention rules, publication
pointers or existing hashes are changed, and no service routing is seeded. The
migration runner commits SQL and its checksum ledger entry in one transaction; a
failed migration rolls back and can be retried unchanged.

Run `pnpm db:check` to inspect checksums and pending filenames without changing
the database. For production, supply the same protected environment as the
release build, including `DATABASE_ENVIRONMENT=production` and verified TLS. The
check does not create or migrate a test database. Production builds print this
plan before applying it; unexpected pending files or checksum mismatches must be
investigated before rollout.
