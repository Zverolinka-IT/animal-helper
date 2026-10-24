# ADR 0010: Case personal data erasure and redaction

- Status: Proposed
- Date: 2026-10-24
- Extends: [ADR 0002](0002-event-sourced-case.md),
  [ADR 0003](0003-capability-access.md) and
  [ADR 0009](0009-passkey-admin-auth.md)

## Context

Reports can contain reporter contact details, precise locations, and
descriptions identifying witnesses or alleged perpetrators. The controller needs
to erase or correct those details while preserving an accurate case lifecycle
and handling retries safely. A person mentioned in a report need not be its
reporter.

The accepted architecture keeps case content outside the append-only event
stream. This makes erasure possible without rewriting the events. It does not,
by itself, implement a complete data-subject-rights or retention procedure. This
ADR records the current implementation and proposes that complete procedure; its
proposed commands, permissions, UI and workers are not implemented yet.

Legal grounds, allegation handling, identity checks, exceptions and response
periods belong to the controller's approved policy. See the
[GDPR briefing](../../legal/gdpr-and-legal-risks.md#data-subject-rights),
[retention discussion](../../legal/gdpr-and-legal-risks.md#retention-and-anonymisation)
and
[EDPB rights guidance](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en).
This architecture must support an approved decision to erase, rectify, restrict
or retain specified information; it must not decide legal entitlement from a
button press or from case closure alone.

## Current implementation

| Store or behavior               | Implemented state                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case domain events              | Lifecycle facts and references to private records; reporter content is excluded.                                                                                                                   |
| `ah.private_records`            | Erasable JSON payloads for contact, text, location, media references and form snapshots. Earlier attached versions remain retained until purged.                                                   |
| `ah.admin_case_work`            | Separately erasable workspace, including notes, referrals and volunteer details.                                                                                                                   |
| `purge_private_data`            | Domain command allowed for completed cases; the first purge emits `case.private_data_purged`. A later purge returns `NOTHING_TO_PURGE`.                                                            |
| Transactional cleanup           | The event-store adapter nulls every undeleted private payload for the stream, sets `deleted_at`, deletes the workspace and updates projections in the same transaction as the purge event.         |
| Draft expiry                    | `expire_draft` emits purge and expiry events for a draft, clearing private stores and expiring its mutation capability.                                                                            |
| Retention scheduling            | Draft creation and case completion create outbox effects for expiry and purge. No automatic consumer currently executes these effects. Closing a case therefore does not itself erase its content. |
| Public command API and admin UI | Reporter commands exclude purge. There is no admin erasure/redaction endpoint or button. The purge primitive requires trusted application-level invocation.                                        |
| Targeted erasure or redaction   | Not implemented. Editing the latest description or contact is not erasure of earlier retained versions.                                                                                            |
| Backups and external copies     | The purge transaction does not erase backups, WAL, browser storage, exported copies or recipients' systems.                                                                                        |

The purge integration test verifies private payload clearing, workspace
deletion, preservation of event history and a projection rebuild after erasure.
Replay cannot recreate a reporter email or description from events that never
contained those values.

The remaining stream IDs, private-record IDs, timestamps, capability records,
command receipts/content hashes, and operator references in events and audit are
not automatically anonymous. They need their own minimisation and retention
decisions. Clearing a PostgreSQL column removes it from normal application
reads; it is not a guarantee of immediate physical removal from old database
pages, replication history or backups.

Workspace deletion also is not an authoritative write barrier. In particular,
the current `seen` path can create workspace metadata again. Privacy-aware rules
for every read/write path are part of the proposed work below.

Implementation references:

- [Domain commands and transitions](../../../packages/domain/src/case/decide.ts)
  and [scheduled effects](../../../packages/domain/src/case/effects.ts).
- [Transactional event-store adapter](../../../packages/event-store/src/apply-command.ts).
- [Admin workspace writes](../../../packages/event-store/src/admin-case-commands.ts)
  and [reads/search facts](../../../packages/event-store/src/admin-case.ts).
- [Purge and replay integration test](../../../packages/event-store/test/apply-command.integration.test.ts).

## Proposed decision

### Keep content erasable and privacy state authoritative

Keep personal case content in private stores, including any future generated
files, media, correspondence and derived indexes. Do not put original or
replacement text, email addresses, allegations, filenames or before/after diffs
in immutable events, audit metadata, outbox payloads or logs. A privacy event
records only opaque operation references and bounded action/scope codes.
Operator identity remains subject to the separate administrator-audit policy.

Add privacy state and a monotonic privacy revision independent of workflow state
and the deletable workspace. An erasure request for a submitted or active case
must not require pretending that the case has been completed. Keep the existing
completed-case purge primitive backward-compatible; introduce explicit
transitions for active-case erasure, targeted redaction and restrictions.

Distinguish application erasure from completion of cleanup across all systems.
The existing `private_data_purged` event proves the transactional private-store
purge, not deletion of a backup or a recipient's copy. Retained evidence should
state which operation and scope finished, without preserving the erased content.

### Review and authorize a concrete request

1. Record a request in an access-controlled, erasable privacy-request store.
   Capture its scope, response deadline and responsible operator. Keep identity
   evidence and explanatory free text out of case events and general audit.
2. Verify identity proportionately. Possession of a report capability
   establishes access to that report, not the identity of every person named in
   it. A third-party request must not disclose the reporter's identity during
   review.
3. Determine affected cases, records and recipients. Decide between full case
   personal-data erasure, person/field-specific redaction, rectification,
   restriction, or reasoned refusal. A disputed allegation may need restriction
   and a separately retained response rather than acceptance as established
   fact.
4. Check any concrete legal obligation or legal-claim hold. A hold has a defined
   scope, authority, owner, review date and expiry. Restrict access to held
   data; erase unheld data where required. Do not report full erasure while held
   content remains. Case closure is not a blanket retention exception.
5. Present an execution preview listing affected stores, record/version counts,
   lifecycle consequences and outstanding external cleanup. Approval binds to
   that exact plan and its privacy/workspace revisions. Expired or changed plans
   require review again.

Add a separate, default-denied permission for privacy operations; ordinary admin
access and account-management permission do not imply it. Reuse the existing
passkey reauthentication and exact-origin protections. Require fresh
reauthentication and explicit confirmation for execution. Log permission checks
and outcomes without logging the private request or proposed redaction text.

### Apply the decision atomically and prevent resurrection

Execute an authorized command through the API, with a stable command ID,
content-binding retry receipt and expected revisions. Lock the same parent case
stream used by reporter and admin mutations, then recheck permission,
authorization scope, holds and the plan under that lock.

Within one database transaction:

- Clear every retained version within scope, not only the latest snapshot.
  Whole-case erasure clears all private case payloads and the workspace.
  Targeted redaction scrubs all affected versions and workspace occurrences,
  preserving unrelated content. Removing a description from a new snapshot is
  insufficient if an older snapshot still contains it.
- Apply schema-aware replacements or redaction markers. A request concerning one
  named person must not indiscriminately erase the reporter or unrelated
  evidence. Do not rely on global substring replacement as proof of complete
  redaction; include manual review of free text and future media where needed.
- Append the appropriate content-free privacy event; update authoritative
  privacy state, private-data availability and affected projections/searches.
  Redaction preserves unrelated workflow state. Any resulting unprocessable case
  needs an explicit disposition, not a fabricated historic transition.
- Persist the minimal audit/receipt and enqueue cleanup jobs containing opaque
  references only. Keep the erasure operation ledger independent of deleted
  workspace rows and revisions.

Every mutation path must enforce the privacy revision and scope, including
`seen`, admin notes, reporter attachment/submission, exports and future jobs. An
in-flight write either commits before erasure and is included in its scope, or
observes the new privacy state and is rejected/revalidated. Whole-case purging
blocks reattachment and workspace recreation; targeted redaction must reject
stale snapshots containing removed content. An expired/retried command must
never restore its old payload through an idempotency receipt.

Review capability revocation/expiry and command-receipt retention together.
Hashes can remain linkable data. Do not delete retry receipts while an accepted
mutation could be retried and applied again; define a bounded retry window and
revoke expired writers before pruning receipts. Replay and application rollback
must preserve privacy tombstones and must not run old writers that ignore them.

### Finish cleanup outside the transaction

Use idempotent workers for scheduled draft expiry, retention-driven case purge
and external cleanup. All use the same policy, hold checks and application
command path as a reviewed manual operation. Recheck a hold at execution time;
an old queued job must not override a later restriction or authorization change.

Track progress per store/recipient: queued, running, completed, retryable
failure or manual/legal review. Retry with stable operation IDs and bounded
backoff; alert on overdue or permanently failing work. A worker failure must not
roll back database erasure or restore private content. UI status must
distinguish application data cleared, cleanup pending, held/restricted, failed
and complete.

Inventory cleanup includes future media/object versions and derivatives,
generated documents, delivery systems, indexes/caches and provider-controlled
copies. Resolve any required deletion references before clearing their only
pointer; keep that manifest restricted and erasable after cleanup. For personal
data disclosed to others, record the applicable notification and recipient
outcome. Independent authorities may have their own lawful retention duties; a
notification is not proof that every recipient erased its copy.

Invalidate reachable browser views and local caches after an operation. A
reconnecting client must fetch current privacy state and discard prohibited
queued writes and cached case content before continuing. Reporter IndexedDB,
session journals and local media require explicit cleanup handling. We cannot
promise remote erasure from an offline device, an unmanaged download or a
screenshot; record and communicate that boundary accurately.

### Bound backup retention and make restores privacy-aware

Define maximum lifetimes and access controls for backups, WAL/point-in-time
recovery and provider logs using the actual provider configuration. Record when
a backup containing erased material can no longer be restored. Active database
erasure and backup expiry are separate milestones; an isolated retained backup
must not become an ordinary source of case content.

Maintain a minimal protected erasure/redaction ledger outside the database's
shared restore boundary, covering every recoverable backup and supported retry
window. The ledger must survive a rollback to a snapshot taken before erasure.
Its retention must be bounded and justified too.

Restore into an isolated environment with intake, reads, dispatch and workers
disabled. Apply all later privacy decisions and reject obsolete queued work
before enabling traffic or allowing exports. Verify the result, then release the
restore barrier. An incomplete/unavailable privacy ledger blocks release; an old
backup must never silently make erased material visible again.

### Close the request with verifiable evidence

The authorized reviewer checks application-store results, external job outcomes,
recipient notifications and backup status against the approved scope.
Communicate what was erased, what remains under a specific exception, and any
delayed or uncontrolled-copy boundary. Record the response and its deadline
separately from case completion. Retain only the evidence needed for the
approved compliance purpose, with restricted access and a defined expiry.

## Consequences and alternatives

Event replay retains lifecycle integrity but deliberately loses erased content.
The proposed workflow adds privacy state, permissions, request records, workers
and restore controls; it is more work than exposing the existing purge command
as a button. It supports targeted requests without automatically deleting all
useful case facts or forcing an active case closed.

Reject appending a redacted replacement while retaining the original personal
payload indefinitely. Reject putting encrypted PII in immutable events and
assuming encryption alone satisfies erasure. Per-case encryption/key destruction
could supplement private storage later, but would need independently verifiable
key, backup and derivative handling. It is not required for this proposal.

Metadata-only events and hashes remain subject to privacy review; this ADR does
not declare the remaining stream anonymous or authorize indefinite retention. No
new production retention periods or legal-hold grounds are established here.

## Delivery and acceptance

Implement in this order: authoritative privacy state and authorized
transactional commands; audited admin review/execution UI; targeted redaction;
retention and external-cleanup workers; restore barrier and end-to-end
operational rehearsal. Expose only supported scopes and accurately label partial
completion during rollout. All schema, event and contract changes require
forward migrations and compatibility review. This ADR alone changes no runtime
behavior.

Acceptance requires synthetic tests and operational evidence that:

- Whole-case erasure clears earlier and latest payloads and workspace content.
- Targeted redaction removes every in-scope occurrence/version and preserves
  unrelated content, including through search and exports.
- Domain replay and projection rebuild cannot resurrect erased information.
- Reporter/admin writes, `seen`, offline retries and worker races cannot
  reintroduce it; accepted-operation retries are idempotent.
- Permission, reauthentication, origin and stale-plan checks fail closed.
- Holds are scoped, expiring and respected by manual and scheduled operations.
- No erased content or replacement PII appears in events, receipts, logs or
  cleanup metadata, beyond separately approved, temporary private manifests.
- Cleanup failures remain visible, retry safely and do not claim completion.
- Restoring a pre-erasure backup reapplies later privacy decisions before any
  case data or pending dispatch becomes accessible.
- The rights-request response, retained evidence and actual backup/device-copy
  boundaries are reviewed against the controller's approved policy.
