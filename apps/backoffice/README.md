# Backoffice PWA

The backoffice is a desktop/tablet-oriented online Vue 3 + Vite PWA for
individually authenticated administrators. See
[ADR 0007](../../docs/architecture/decisions/0007-vue-static-pwas.md) and
[ADR 0009](../../docs/architecture/decisions/0009-passkey-admin-auth.md).

This slice is passkey login, a case queue with the reporter summary, a case page
for internal follow-up, and guidance administration for all five report flows.
Each guidance tab uses the same animal list, fuzzy search and group filter.
Injured guidance retains its matrix editor; stray, dead and human-activity
guidance show general, inherited and animal-specific profiles with editable
warnings and ordered contacts. Their preview uses the customer resolver, so
inherited instructions remain visible until an explicit override is saved. Road
routing is shared across animals because contact selection precedes
identification; cruelty shows the shared police/documentation workflow for the
selected animal. Publishing includes the whole saved guidance draft. Opening a
case audits the read. It does not dispatch mail or store authority files; those
stay as copied filenames.

All five tabs render the same `GuidanceWalkPreview` component with a reachable
screen map, branch choices, current-screen copy, Back and Restart. The pure
`guidance-preview.ts` model describes the adapter's location, identification,
police outcome, documentation, contact and submission routes. The preview uses
the customer's `reportGuidancePaths` helper and injured routing/content
resolvers. Both profile and injured editors preview unsaved copy and enabled
contacts. A road report's further-help choice is shown as an explicit handoff to
the injured flow for the newly identified animal. Preview controls never issue
commands, submit a report, start a phone call or publish guidance.

`npm run dev` from the repository root starts Docker Postgres, the API on
`http://127.0.0.1:8787`, the customer app on `http://localhost:5173`, and this
app on `http://localhost:5174`. Vite proxies `/admin` to the API so session
cookies stay first-party. Open the backoffice at `http://localhost:5174`, not at
port 8787. Use `localhost`, not `127.0.0.1` — passkeys require that hostname.

Create a named operator (no public sign-up):

```sh
pnpm admin:bootstrap -- --email you@example.com --open
```

The command writes a private HTML file with a 15-minute, one-use setup link. It
does not print the token. After opening that file, register a platform passkey,
then sign in again later with the same authenticator.

After enrolling the initial account manager, grant account-management permission
using the trusted maintenance command:

```sh
pnpm admin:bootstrap -- --email you@example.com --grant-management
```

In production, run this with the production environment and verified database
TLS in a trusted maintenance context. The flag only updates an already enrolled,
enabled account; it does not create a setup link or reset passkeys.

Account managers see **Správcovia** (`/operators`). The **Aktívne účty** list
includes **Povoliť správu účtov** and **Odobrať správu účtov** for other
enrolled accounts. Confirm the change with your passkey. Existing sessions
receive the new permission immediately on the server; the affected person
refreshes the page to update the navigation. Your own account cannot be demoted
from this screen. The maintenance command above remains the initial
setup/recovery route.

Generating or revoking an invitation requires fresh passkey verification bound
to the current account and session. The page displays a private 15-minute,
single-use link once; copy it and deliver it privately. Regenerating a pending
invitation invalidates its old link. Existing enrolled or disabled accounts
cannot be invited through this page. Invited operators have ordinary admin
access and cannot manage accounts. Links stay in component memory, never browser
storage, and are omitted from the pending-invitation response. No email is sent
automatically.

Safari stores those keys against the RP ID `localhost`, shared with every other
local site. If login offers passkeys that never succeed, they are leftovers
(failed setup, another local app, or a database reset). Delete the `localhost`
passkeys for this address in Passwords, then register one new key from a
bootstrap link:

```sh
pnpm admin:bootstrap -- --email you@example.com --open --reset-passkeys
```

The queue lists case number, situation, species, place, and admin status. The
case page reads location, form snapshot, and contact from private records.
Newsletter consent is not shown. Admin notes, actions, referrals, and
inspections are stored in `ah.admin_case_work`.

Case writes use versioned contracts, an expected workspace revision, and a
client-generated command ID. Stale edits return a conflict for explicit reload;
retrying an ambiguous request keeps its ID. Workspace changes, lifecycle events,
command receipts, and audit records commit together under a case lock. Taking
over a submitted case starts review; closing it completes the authoritative case
and updates its public status. Reads mark the case seen without advancing the
edit revision. The queue loads further pages, and a case detail is queried
directly rather than through the newest page.

All admin text searches (case queue, contact directory and guidance catalogue)
share `@animal-helper/search`: partial matching ignoring case and accents, with
limited typo tolerance including swapped letters. Whitespace-separated terms
match in any order, including across fields. Terms shorter than four
letters/digits stay literal; four to seven allow one edit and longer terms two.
The queue's general text, reporter email and assigned-admin email fields combine
with AND; press **Filtrovať** to apply them or **Zrušiť filter** to clear them.
All three search across the full queue before pagination. General text also
includes both email fields. Unapplied text does not change pagination. Directory
and guidance search their complete, already loaded collections. Exact service,
animal-group and status selectors retain their existing semantics.

Private-data purge also removes the admin workspace, including notes, volunteer
details, and referral information.

**Matica sprievodcu** (`/guide`) browses the code-owned
`@animal-helper/guidance` catalog and edits injured copy. Save writes a draft;
publish makes that revision the public `GET /guidance` payload. Preview uses the
same resolver as the customer walk. Stray and cruelty stay read-only. Rollback,
and subject-matter review-date gating are not in this slice.

Contact instructions are an ordered list of one or more enabled options rather
than fixed primary/secondary slots. Each option has a stable ID, service
category, heading and instructions. Admins can add, remove, move and disable
options; phone numbers and individual organisations continue to come from
**Kontakty**. The initial editor derives its list from existing primary,
secondary and volunteer instructions, preserving their wording and order. Saving
replaces those legacy contact cells with the complete ordered list in one
revision-checked transaction. Publishing makes that list available to new
customer walks. The preview follows the same dynamic steps as the customer
resolver.

**Kontakty** (`/contacts`) administers public services, telephone/HTTPS website,
address, optional coordinates, service areas, opening hours and notes. Active
entries require a source URL, verification date and next review deadline before
publication. Municipal contacts require exact GeoJSON boundaries; other services
can use a radius or national coverage. Import supports Polygon/MultiPolygon
features and collections, with at most 2,000 points and bounded serialized size.

**Veterinárne kliniky** (`/clinics`) provides a dedicated view of regular and
exotic-animal veterinary services. It uses the same editor, fuzzy search,
CSV/Excel importer and directory records as **Kontakty**, including addresses,
coordinates, coverage, opening hours, verification and enabling/removal. New
entries default to `vet_clinic`; filtering and import defaults offer
`vet_clinic` and `vet_exotic`. Clinic edits and imported rows must retain at
least one veterinary service, while additional services on shared records are
preserved. Mixed lists without a veterinary service can be imported through
**Kontakty**. Clinic publication explicitly publishes the entire shared
directory, including pending volunteer and other contact changes; all active
records must pass the existing publication checks. There is no separate clinic
database or publication revision.

Use **Importovať CSV / Excel** to upload an initial contact list (`.csv`, `.xls`
or `.xlsx`). Choose the worksheet and header row, check the suggested column
mapping, then preview and select rows before importing. English and Slovak
headers are recognized; CSV supports UTF-8 and Windows-1250. A downloadable CSV
template lists the supported fields. Multiple services can be separated by
semicolons, commas or pipes; blank services use the selected default. Unmapped
columns are listed and ignored, including email addresses, which the current
directory does not store.

Files are parsed locally in a worker, with limits of 5 MB, 20 worksheets, 50
columns and 1,000 contact rows. Only the selected, validated records are sent to
the API. Exact duplicates are skipped; existing records are never overwritten.
The selected batch is saved atomically with the draft revision and a retryable
command ID. New contacts are always hidden drafts. Review their coverage,
contact details and verification fields, enable them, then publish separately.
Opening hours remain unknown; missing verification dates are not invented. The
Excel reader is pinned to the official
[SheetJS CE distribution](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)
and bundled with the admin app; importing does not fetch remote scripts.

Save writes only a draft. Publish creates an immutable snapshot and a new
guidance publication retaining the existing published copy, without publishing
copy drafts. Later copy publications retain the current directory. Disabling or
removing a contact affects customers only after publication. Expired contacts
stop appearing automatically; missing contacts produce an explicit unavailable
message. The directory starts empty: populate it with verified operational data.

All enabled operators can manage contacts, matching guidance-edit permissions.
The API enforces sessions, origin checks, strict schemas, revision conflicts,
idempotent retries and transactional audit. The UI preserves conflicting input
until explicit reload and warns before abandoning unsaved edits.

Later technical responsibilities remain:

- present the least private data needed for queue triage;
- record auditable case transitions and restricted-data reads;
- select versioned Slovak routing/form definitions;
- roll back a published guidance revision and record subject-matter review;
- confirm exact recipient and content before an idempotent dispatch;
- make retention completion, outbox failures, and security warnings visible.

There is one permission role initially, but accounts remain individual.
Publication will be an authenticated, passkey-assured, audited operation; the
editor cannot create arbitrary screens, branches, HTML, or executable rules.
