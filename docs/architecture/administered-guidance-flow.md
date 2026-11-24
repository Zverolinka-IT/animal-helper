# Administered guidance flow

Status: **implemented for all five report flows and public contact directories**

Last reviewed: 2026-10-22

The customer PWA will contain a short, fixed-screen guide for a person who finds
an injured or distressed animal. The guide is not a report workflow or a
general-purpose form builder. Its topology is an application contract; the
backoffice administers localized copy and an animal-specific decision matrix
within that contract.

After each local command (or a local continue, such as skipping photo), the PWA
resolves a **walk view**: which screen to show, the data needed to render it,
allowed command kinds, and optional field errors. That document is produced on
the device from the catalog, the last valid guidance revision (or bundled
fallback), and walk facts already on the device. The HTTP command reply may
optionally echo the same `walkView`; it is not required to continue offline. Vue
maps `screen` to a layout. Administrators still cannot add a new screen type
without an app release.

## Product and technical boundary

A person selects an animal kind (including an unknown/unsure fallback), and the
PWA presents the relevant do/don't guidance. The operational team can correct
wording and matrix outcomes without a frontend deployment, while changes to the
shape of the interaction still receive normal product, accessibility, and
application review.

| Code-owned flow schema                                          | Administrator-owned guidance revision                    |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| screen count, kinds, order, and allowed transitions             | localized copy for fixed screen, option, and text slots  |
| stable screen, option, animal-kind, and instruction keys        | instruction applicability by animal kind                 |
| instruction polarity and conflict/exclusion groups              | ordering and bounded copy overrides                      |
| allowed action kinds and validation/length constraints          | references to approved jurisdiction contact/action keys  |
| bundled conservative fallback for each supported schema version | provenance, review metadata, and publication description |

Administrators cannot add screens, arbitrary predicates, executable rules, HTML,
or raw remote links in the first release. A typed action such as `call-contact`
may refer to an allow-listed jurisdiction entry; it does not carry an arbitrary
telephone number or URL in matrix copy.

Static application chrome, validation, and accessibility messages remain in
package locale dictionaries. Administrator-managed guidance lives in
locale-scoped revisions keyed by fixed semantic copy slots. Jurisdiction is a
separate scope used only where advice, approved contacts, or escalation differs.

## Decision matrix

The backoffice presents animal kinds as rows and guidance items as columns. A
guidance item is a stable instruction slot with a polarity such as `do` or
`do-not`. A cell controls whether that item applies and can supply a bounded
order or copy-slot override.

The persisted model is normalized rather than dependent on a spreadsheet-shaped
table:

```text
flow_schema_registry (code-owned)
  flow_key, schema_version
  screen_key, option_key, animal_kind_key, instruction_key
  copy_slot_key, action_kind, conflict_group?, constraints

guidance_revision (immutable after publication)
  revision_id, flow_key, schema_version, locale, jurisdiction
  status, based_on_revision_id, created_by, created_at
  directory_revision_id? (immutable published contact snapshot)
  source_references, content_reviewed_at, review_reference?

guidance_copy (revision-owned)
  revision_id, copy_slot_key, plain_text

guidance_cell (revision-owned)
  revision_id, animal_kind_key, instruction_key
  applicability, copy_slot_override?, order_override?, action_target_key?

guidance_publication
  flow_key, schema_version, locale, jurisdiction, active_revision_id
```

The matrix UI may show inheritance and overrides, but the API resolves a
complete read model before publication. Resolution first uses an explicit
animal-kind cell and then the configured generic/unknown-kind row. A required
cell that still cannot resolve blocks publication; the customer must never
invent advice.

The bundled fallback has a different job: it keeps the guide available when no
compatible remote or cached revision exists. It must not make an incomplete
server revision publishable.

Validation covers the whole result, not only individual cells. It must catch
unknown keys, missing required copy, duplicate or invalid order, empty result
screens, contradictory items from the same conflict group, invalid typed action
targets, and missing generic guidance. If another fixed answer later changes an
outcome, it becomes an explicit bounded matrix dimension in a new flow schema
version rather than an ad-hoc expression.

When a typed action references a jurisdiction contact, publication resolves it
against a pinned jurisdiction-pack version and snapshots the public-safe action
target into the immutable public projection. A later directory edit cannot
silently change already published guidance or its content hash.

The exact animal kinds, instruction registry, and screen mapping live in
`@animal-helper/guidance`. Injured copy is imported from the
[case matrices](../product/case-matrices/README.md) into a bundled fallback and
the same resolver serves backoffice preview and `GET /guidance`. Administrators
toggle applicability, edit bounded plain text, and publish an immutable
revision. Stray rows remain stubs. Cruelty is catalogued, not public. There is
no generic/unknown-kind row in the matrices, so publication validates catalogued
injured kinds instead. Contact snapshots are administered through `/contacts`.
Directory publication creates a new guidance revision with the current published
copy and reviewed contacts; it cannot publish pending copy drafts. Both
publishers serialize pointer updates, and copy publication retains the current
directory snapshot. The public hash covers both versions. Rollback UI and
IndexedDB last-known-valid storage are still later work. Stable semantic
keys—not labels—allow wording to change without changing stored selections.

## Content governance

Schema validation can prove structural consistency, not that animal-care advice
is correct. Each publishable revision therefore records its sources, the date
the content was reviewed, and a reference to the responsible subject-matter
review. The backoffice shows this alongside the content diff and blocks
publication when required review metadata is absent.

The initial single application role does not imply that every administrator is a
qualified content reviewer. Review can be an organisational process recorded by
reference until separate system roles are justified. A review-due date may warn
operators, but the customer guide should not suddenly become empty on an offline
device; any hard-expiry policy must define a reviewed fallback.

## Revision lifecycle

Guidance is managed as immutable revisions:

1. An administrator creates a draft from the active compatible revision.
2. The editor changes allowed copy slots and matrix cells using optimistic
   concurrency.
3. The API validates the fully resolved flow and required review metadata.
4. The backoffice renders every reachable mobile result and a semantic diff from
   the active revision.
5. A passkey-assured administrator confirms publication with a change
   description.
6. The API atomically moves the active pointer and records actor, revision IDs,
   content hashes, and timestamp in the audit log.

Published rows never change. A rollback is an audited pointer change to a
previously published compatible revision. A subsequent correction is made as a
new revision, preserving what was available and when. Withdrawn historical
revisions remain available to restricted audit/history tools but are not
addressable through the public endpoint.

Publication needs an emergency rollback path and an operator-visible signal when
clients repeatedly reject a revision as incompatible. Two-person publication can
be added later without changing the content model.

## Schema compatibility and customer runtime

Installed PWAs and open tabs can remain on older application versions. One
global “latest” pointer would strand those clients after a schema change.
Publication is therefore keyed by
`(flow_key, schema_version, locale, jurisdiction)`.

The customer requests the active revision for a schema version it understands.
The API never lets it select an arbitrary historical revision. The public
response contains only resolved content, revision ID, schema version, content
hash, content review date, and safe cache metadata—never drafts or administrator
identity.

The PWA:

- validates the complete payload before making it active;
- retains the last valid revision for each supported schema in a dedicated
  IndexedDB store and uses conditional requests such as `ETag`;
- keeps using its last known valid revision when offline or after a malformed
  response;
- uses its bundled reviewed fallback if no valid revision has ever loaded;
- presents update/offline age only where the product team determines it helps
  rather than distracts during an urgent situation;
- never evaluates arbitrary conditions received from the server.

Schema rollout is additive: deploy a client that understands the new version,
publish content for it, and keep the preceding schema's publication available
during a defined compatibility window. Schema retirement is an explicit release
decision, not a side effect of publishing copy.

A content hash detects partial or inconsistent updates; it is not a substitute
for authenticity. HTTPS, API/deployment controls, and public-endpoint tests
remain the trust boundary.

## Backoffice and API responsibilities

The backoffice is an authenticated editor and preview surface. It never writes
configuration tables directly. The API enforces:

- individual administrator authentication, passkey assurance for
  publish/rollback, CSRF protection, and object-level authorization;
- bounded plain text and references to code-owned keys only;
- complete matrix resolution, conflict checks, deterministic ordering, safe
  generic guidance, and valid typed actions;
- locale/jurisdiction and schema compatibility, including public-safe action
  targets resolved from a pinned jurisdiction-pack version;
- optimistic draft concurrency and atomic publication;
- audit records for draft mutation, publication, rollback, and failed attempts.

The editor combines a matrix view, a semantic diff, and exhaustive
screen-by-screen preview. A rectangular grid alone will not reveal every empty
screen, contradictory instruction, unreachable result, or stale source.

## Verification contract

Preview and publication must not implement separate decision logic. The API
produces the same resolved public payload for preview and publication, and the
backoffice preview uses the customer flow renderer in a non-interactive preview
mode where practical.

Automated evidence should cover:

- every animal-kind/result combination for each supported schema fixture;
- generic-row resolution, conflict groups, ordering, and typed action targets;
- locale completeness and pinned jurisdiction-pack resolution;
- rejection of unknown keys, malformed copy, incomplete matrices, drafts, and
  incompatible schema versions at the public boundary;
- immutable published rows and atomic publish/rollback pointer changes under
  concurrent requests;
- an older customer fixture receiving its own active schema-version revision;
- offline startup with a last-known-valid revision and with only the bundled
  fallback;
- equality of preview and published payload hashes for the same draft.

## Storage, history, privacy, and analytics

Guidance revisions are public operational content, not case event streams. They
use ordinary versioned tables, immutable published rows, an active-publication
pointer, and the security audit log. Draft/public projections omit creator
identity where it is not required.

If guide answers help triage, store the selected stable keys in the case's
erasable private data and store the non-sensitive `revision_id` as durable event
metadata. Do not copy rendered guidance into the case. This preserves
reproducibility without retaining potentially revealing answers forever.

Audit records should identify the old/new revision IDs and hashes; they should
not duplicate full content or user selections. URLs and capabilities contain
neither selections nor revision IDs. Initial analytics record neither selected
paths nor animal kinds. A revision ID may appear alone in coarse operational
telemetry so incompatible or rejected publications can be detected.

Public guidance in IndexedDB is separated from the case draft store and from the
service worker's Cache API. It is never mixed with capabilities, private API
responses, signed media URLs, or administrator responses.

## Initial scope and later extensions

The first implementation supports one fixed guide, a finite set of
screens/options, one generic animal-kind fallback, locale-scoped plain text,
matrix applicability/order overrides, typed approved actions, exhaustive
preview, publish, rollback, and audit.

It does not include drag-and-drop flow design, arbitrary predicates, per-user
personalization, direct historical-revision access, or a workflow runtime.
Possible later additions—only with evidence—include scheduled publication,
two-person approval, richer bounded dimensions, and privacy-reviewed aggregate
metrics.

## Remaining product decisions

Injured instruction slots, bundled fallback import, draft/publish, and public
`GET /guidance` are wired. Still open:

- subject-matter sign-off of the imported matrices, including a review date
  required in production;
- a generic/unknown-kind row (the matrices do not have one);
- whether guide selections become erasable case data for triage;
- jurisdiction-pack phone snapshots for `call-contact`;
- rollback UI, IndexedDB last-known-valid storage, and how stale/offline
  guidance is shown during an urgent flow.

## All report flows (2026-10-22)

All five situations create a capability-protected case and submit through the
same command client. Situation-specific details remain in versioned private form
snapshots, not event payloads or public status. The admin workspace displays
stray behaviour, death indicators, cruelty circumstances and police outcomes,
road/human/other details, reported outcomes, and explicit draft-closure results.
Existing v1 injured/stray snapshots remain readable.

The code owns fixed branching: cruelty documents the police outcome (or skips it
for non-acute cases) and ends at W39; general other reports also end at W39.
Road failures preserve the known location, collect identification, and reach
W38. Requesting further injured-animal help keeps the original road case and
service outcome. Closing a draft opens W26; an early draft first collects the
required location. Closure records one outcome and optional description, and
only clears the local case after the server accepts submission.

`guidance_revisions.report_profiles` extends the existing publication with
validated profiles for stray animals, suspicious/non-suspicious dead-animal
findings, individual human-activity circumstances, and each road choice.
Human-activity circumstances fall back to the general human-activity profile.
Road profiles apply to all species because routing precedes identification. Each
context can have a default profile and explicit animal-kind overrides. Profiles
contain bounded plain-text warnings/instructions and up to 24 ordered contact
options. An explicit empty species profile suppresses the default. No arbitrary
branching predicates or executable code are allowed. Cruelty and general-other
report boundaries are fixed; they do not inherit the injured guidance tree.

Profile edits use the same optimistic content hash, draft/publish boundary and
operator audit as the injured matrix. Canonical hashes include nonempty profile
lists; empty lists preserve existing hashes. Guidance publication and directory
publication both copy the profiles into the immutable revision. Customer drafts
pin that publication and its contact directory in the local checkpoint,
including before road identification. Admins can edit and preview these profiles
in the situation tabs of the guidance screen.

Figma documentation (file `Y6LY2VRpRoxNKNJEQACH6Y`, section `908:8091`) confirms
these interaction boundaries, including W26 (`1097:5392`) and W38
(`1596:15066`). The design refers to separate, unavailable business
documentation for exhaustive species/service routing. No unverified service
mappings have been seeded: an absent profile clearly explains the missing
verified guidance and still permits documentation and submission. The existing
injured fallback remains unchanged. Operators must review and publish the new
profile content.

A tab-local synchronous journal protects the latest controls if reload
interrupts a queued IndexedDB write; case identity and timestamps prevent an
older journal from replacing a newer durable checkpoint. Local checkpoints
retain branch choices, police/service outcomes, visited help, form controls and
navigation position across reloads. Retry preserves command IDs for the same
submission; changed report attachments supersede a queued submission and compete
at its expected version. A report already accepted by the server remains
read-only. Files selected in the existing media picker are still local browser
files; this change does not add binary media storage or AI identification.
