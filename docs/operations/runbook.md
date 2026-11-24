# Initial operations runbook

This is a skeleton to be made executable during the platform spike. It names the
operational responsibilities that must not remain implicit.

## Environments

| Environment | Data                     | External delivery                      | Purpose                           |
| ----------- | ------------------------ | -------------------------------------- | --------------------------------- |
| local       | generated synthetic only | captured locally/test provider         | development and integration tests |
| preview     | generated synthetic only | fixed allow-list of team addresses     | pull-request acceptance           |
| production  | real reports             | reviewed authority/reporter recipients | controlled pilot and service      |

No database copy flows from production to preview or local. Synthetic generators
must cover debugging and demos.

## Deployment

1. CI verifies format, lint, type checks, unit/integration tests, build,
   migrations, and security checks.
2. Apply backward-compatible database migrations.
3. Deploy API/functions and workers.
4. Run synthetic command/upload/outbox smoke tests.
5. Deploy immutable PWA assets.
6. Observe error/outbox/cleanup metrics.
7. Complete any destructive migration only in a later release after old code is
   retired.

Roll forward by default. Database migrations require a documented recovery path;
application rollback must not cause old code to misread new events.

### All-flow release prepared 2026-10-22

This release adds all five report types, their private case facts, and reviewed
guidance profiles in admin. New migration:
`20261022160000_report_guidance_profiles.sql`, SHA-256
`99ad6a6341f60ccb414678fc99553a789898e05ccba55bb102fc9cfaa9fd34b7`. There is no
event replay, private-data backfill or automatic guidance publication. See the
[migration notes](../../supabase/migrations/README.md) for locking and
compatibility. Keep the SQL unchanged once applied.

Production projects belong to team `team_N2I174HIv0Q8oXyqR0gLTGbO`
(`zverolinka`):

| Application | Project                            | Root            | Production URL                              |
| ----------- | ---------------------------------- | --------------- | ------------------------------------------- |
| API + admin | `prj_2HPlygOSpKsjW8fT4gqpTs43oj5j` | `apps/api`      | <https://animal-helper-admin.vercel.app>    |
| Customer    | `prj_viUkftKnVubqHxV3BOv48eCJw7dE` | `apps/customer` | <https://animal-helper-customer.vercel.app> |

Use Node 24 and pnpm 11.18.0. The API production environment already has
`DATABASE_URL`, `DATABASE_MIGRATION_URL`, `DATABASE_ENVIRONMENT`,
`DATABASE_SSL_MODE`, `CAPABILITY_PEPPER`, `ADMIN_ORIGIN`, and `API_CORS_ORIGIN`;
the customer has `VITE_API_BASE_URL`. No new secrets are needed. Keep the
capability pepper and passkey origin unchanged. Expected non-secret values are
`production`, `verify`, the admin origin above, and the customer origin above,
respectively; `VITE_API_BASE_URL` must be the admin/API origin. Variable
presence was checked through Vercel; encrypted values and the production
migration ledger remain to be checked in the protected release build.

Release procedure:

1. Freeze the reviewed working tree, including new source files and all SQL
   migrations. A checkout of the old Git HEAD alone omits this work. Keep a file
   checksum manifest with the release receipt; exclude local environment files,
   credentials, editor state, generated output and `node_modules`.
2. Run `pnpm check`. Also run `node vercel-build.mjs` from `apps/api` without
   `VERCEL_ENV=production` to check the actual function bundle, and build the
   customer with `VITE_API_BASE_URL=https://animal-helper-admin.vercel.app`.
   These local builds do not access or migrate production.
3. Use separate source copies linked to the two project IDs above. From each
   repository root, `vercel deploy --prod --skip-domain --scope zverolinka`
   creates a staged production deployment. Stage API/admin first. **This runs
   production migrations even before promotion.** The API build checks the
   ledger and applies pending SQL transactionally before it can become ready.
   Earlier admin-command, invitation and directory migrations are retained in
   the release; their presence as untracked Git files does not imply they are
   unapplied in production. The previous directory release receipt records their
   deployment. Inspect the build's migration plan and stop on any unexpected
   pending migration or checksum error.
4. Check staged API/admin through authenticated `vercel curl` (deployment
   protection may apply): `/health` and `/guidance` return 200;
   `/admin/session`, `/admin/cases`, `/admin/contact-directory`, and
   `/admin/guidance/report-flows` return 401 without an operator session. Check
   that HTML and referenced assets load. The customer origin must be allowed by
   CORS. A health response alone does not verify the database.
5. Confirm the live aliases still refer to the captured previous deployments,
   then `vercel promote <staged-admin-url> --scope zverolinka`. Stage and
   inspect the customer and promote it only after the API is healthy. Recheck
   production frontend asset hashes against the staged builds. Record both new
   deployment IDs, prior IDs, migration plan, source digest and smoke results.
6. On the real admin origin, sign in with an existing passkey, inspect the five
   guidance tabs and case facts, and verify draft save/conflict behavior using
   clearly synthetic content. Review the existing draft before publishing:
   publication covers the entire guidance draft, including injured cells.
   Operators must supply reviewed warnings, instructions and ordered contacts
   for new profiles; the release deliberately starts them empty. Do not publish
   invented routing merely to populate the UI.
7. Verify a synthetic report from each flow reaches admin with its branch
   answers, closure and contact outcome; public status must expose no private
   facts. Verify reload/retry and the road-to-injured-help continuation.
   Imported directory entries remain disabled until reviewed; import is not
   publication.

Rollback baseline recorded before preparation:

- Admin/API: `dpl_FBoFs4sjSts7K1rXqhShww8NZPKK`.
- Customer: `dpl_866ehG1enPU8ZXwKBnF36VZZCDdP`.

Refresh these IDs from the live aliases before promotion. Leave the new column
and migration ledger intact during an application rollback. If the API build
fails after migration, the old application can continue using the additive
schema. Once new clients are live, prefer a forward fix: rolling back the API
can reject their new form payloads, and the old admin cannot preserve new
profile content when editing/publishing. If reverting both applications is
necessary, revert the customer first, suspend guidance edits/publication, retain
new private snapshots, and account for already-open tabs/offline drafts still
using the new client. Never delete profiles or replay/alter case events to make
old code accept them.

Validation before preparation included the full repository check and Chromium
flow/admin checks. Safari verification is still unconfirmed: the local WebKit
runner fails before page load with `Unknown setting: PushAPIEnabled`. Binary
media upload/AI identification and the sample map/search locations are existing
limitations, not capabilities introduced by this release.

## Daily checks during pilot

- oldest pending/failed outbox item;
- oldest incomplete deletion;
- orphan/staging media count and age;
- provider quota/budget alerts;
- administrator authentication anomalies;
- API error/rate-limit trend;
- most recent successful production smoke test.

## Incident priorities

1. protect reporters and stop further disclosure or destructive effects;
2. preserve minimal, safe evidence and revoke affected sessions/keys;
3. establish scope without copying case contents into chat or issue trackers;
4. assess controller/provider/legal notification duties;
5. restore safe operation and verify queued commands/outbox items;
6. record lessons and update the threat model.

Kill switches are required for new intake, media upload, administrator export,
outbound dispatch, and public status independently.

## Provider outage

- Customer: keep a bounded local draft/queue and clearly say it is not yet
  received.
- API/database: stop claiming submission; preserve command IDs for retry.
- Object store: retain local blobs and do not submit incomplete media
  references.
- Email: retain an idempotent outbox item and show delayed delivery to admin.
- Static host: publish service status through a separately controlled minimal
  channel once one is selected.

## Key compromise

Maintain an inventory mapping each key to owner, environment, scope, creation,
last rotation, and revocation procedure. On suspected exposure:

1. disable or rotate the key at the provider;
2. stop affected functionality if rotation is not atomic;
3. inspect provider audit metadata without exporting report bodies;
4. replace environment secrets and redeploy;
5. invalidate derived signed URLs/sessions where possible;
6. complete breach assessment.

Removing a secret from Git or redeploying without rotation is insufficient.

## Data recovery

[ADR 0010](../architecture/decisions/0010-case-personal-data-erasure.md) records
the current erasure limits and proposes the privacy ledger and restore barrier
needed to prevent backups from reintroducing erased case content. Those controls
are proposed work, not an implemented restore guarantee.

Neon Free keeps a short restore window (hours, not days) and may scale to zero.
If used for a pilot, the operator must explicitly accept that older accidental
deletion/corruption may be unrecoverable. Launch adds a longer restore window.
Before broader production:

- choose backup frequency and recovery objectives;
- encrypt backups separately from provider credentials;
- include event store, private relational data, configuration, and object
  inventory;
- test restore into an isolated environment using synthetic validation;
- confirm retention/deletion obligations also apply to backups;
- record the last successful restore test.

## Ownership still to assign

- incident commander and privacy/legal contact;
- administrator account approver;
- authority directory/form reviewer;
- provider billing and quota owner;
- vulnerability-report recipient;
- backup/restore owner;
- data-retention exception approver.
