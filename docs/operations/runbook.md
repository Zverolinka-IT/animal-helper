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
