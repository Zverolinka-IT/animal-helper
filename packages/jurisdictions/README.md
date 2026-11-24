# Jurisdiction packs

`@animal-helper/jurisdictions` implements public contact selection for Slovakia.
The backoffice **Kontakty** page (`/contacts`) manages drafts and publishes
reviewed entries. No production telephone numbers are seeded.

The versioned contracts define service keys, telephone/HTTPS website, address,
optional coordinates, service area, opening hours, notes, source URL,
verification date and review deadline. Municipal contacts require exact GeoJSON
boundaries; other services can use a radius or national coverage. GeoJSON import
supports polygons, holes, multipolygons and feature collections within bounded
size.

Publishing creates an immutable directory release and a new guidance revision
that pins it. It copies the current published guidance, never a copy draft. Both
publishers serialize updates; later copy publications retain the current
directory snapshot. Writes use optimistic revisions, idempotent command receipts
and transactional audit. Disabled entries are excluded from public snapshots.

`GET /guidance` includes the pinned public directory and hashes its release ID
with the copy hash. The customer filters service areas and expired/unverified
entries before sorting by straight-line distance. Case coordinates stay on the
device for directory selection. Navigation opens the selected destination only
when activated. Hours use `Europe/Bratislava`, including overnight shifts and
DST; holiday exceptions belong in public notes. Unknown hours never imply
availability. Missing contacts show an explicit unavailable state. Availability
and review expiry refresh while the screen stays open.

The broader pack responsibilities below remain the boundary for future work;
official forms and automated authority dispatch are not implemented.

A jurisdiction pack contains versioned operational data, not UI translations:

- authority and volunteer directory entries with source and verification date;
- routing criteria and administrator guidance;
- official-form templates and field mappings;
- recipient/channel constraints;
- jurisdiction-specific privacy/legal notice references.

Packs are reviewed data with provenance. They never contain provider credentials
or case data. A generated document snapshots its pack/template version so a
later official-form update does not rewrite history.

Customer guidance may reference a typed, public-safe contact action by stable
directory key. Guidance publication pins the jurisdiction-pack version and
snapshots the resolved public target so a later directory update cannot silently
rewrite already published advice.
