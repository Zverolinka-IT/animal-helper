# API

Local Node HTTP command and status boundary. Production runs this same handler
as a Vercel Function in `fra1`, on one origin with the backoffice build so admin
cookies stay first-party.

The API is the sole public domain-command boundary. It:

- validates versioned contracts;
- authenticates a case capability;
- invokes the event-store adapter;
- returns explicit, non-sensitive command and status results.

It does not proxy bulk media, expose tables directly to browsers, or log
capabilities, command bodies, or `Authorization` headers.

## Local endpoints

`GET /admin/contact-directory` reads the operator-only draft and published
summary. `POST /admin/contact-directory` accepts versioned `save_entry`,
`remove_entry` and `publish` commands with a command UUID and expected draft
revision. It uses the same session/origin boundary as other admin operations.
Writes, receipts and audit commit atomically; stale edits return 409.

`POST /admin/contact-directory/import` accepts the same versioned envelope with
an `import_entries` command containing 1–1,000 validated entries, all with
`enabled: false`. The batch appends new entries, skips exact duplicates and
never overwrites existing contacts. The complete resulting draft must fit the
existing directory limits. Imports use the same session, origin, revision,
receipt and audit controls, and commit as one transaction. Only this POST route
allows a 2 MB JSON body; other routes retain the 64 KiB limit. CSV/Excel files
stay in the admin browser, which submits only selected records. Importing does
not publish contacts or create a new public guidance release.

`GET /guidance` includes an optional public `contactDirectory` snapshot pinned
to the guidance revision. Draft edits never change it. Explicit directory
publication creates a new guidance release preserving published copy and changes
the ETag. It never publishes pending guidance copy drafts. Apply the
contact-directory migration before running the updated API.

`npm run dev` starts Docker Postgres, this process on `http://127.0.0.1:8787`,
the customer Vite app on `http://localhost:5173`, and the backoffice on
`http://localhost:5174`. Loopback API processes default CORS to the customer
origin only. Admin routes are cookie-authenticated on the backoffice origin
([ADR 0009](../../docs/architecture/decisions/0009-passkey-admin-auth.md)).
Ctrl+C does not stop Postgres; use `pnpm db:down`.

| Method | Path        | Auth                                    | Purpose                                      |
| ------ | ----------- | --------------------------------------- | -------------------------------------------- |
| `GET`  | `/health`   | none                                    | liveness                                     |
| `GET`  | `/guidance` | none                                    | active injured guidance, or bundled fallback |
| `POST` | `/commands` | `Authorization: Capability <base64url>` | reporter draft commands                      |
| `GET`  | `/status`   | `Authorization: Capability <base64url>` | public `draft/received/closed`               |

Admin routes (same origin as the backoffice PWA; ceremony or session cookie):

| Method | Path                                     | Purpose                            |
| ------ | ---------------------------------------- | ---------------------------------- |
| `POST` | `/admin/auth/register/options`           | passkey registration options       |
| `POST` | `/admin/auth/register/verify`            | finish passkey registration        |
| `POST` | `/admin/auth/login/options`              | passkey assertion options          |
| `POST` | `/admin/auth/login/verify`               | finish passkey sign-in             |
| `POST` | `/admin/auth/logout`                     | revoke session                     |
| `GET`  | `/admin/session`                         | restore operator                   |
| `GET`  | `/admin/queue`                           | read-only case queue               |
| `GET`  | `/admin/guidance`                        | guidance draft/publication summary |
| `GET`  | `/admin/guidance/kind/injured/{kindKey}` | editable cells and preview items   |
| `POST` | `/admin/guidance/cells`                  | save one instruction cell          |
| `POST` | `/admin/guidance/publish`                | publish the current draft          |

Reporter commands in this slice: `create_draft`, `attach_private_data`,
`submit_draft`. Administrator domain commands still return
`UNSUPPORTED_COMMAND`. Query strings on `/commands`, `/status`, and `/guidance`
are rejected (`AH-SEC-007`, `AH-SEC-046`). Create operators with
`pnpm admin:bootstrap`.

Case-work endpoints are `GET /admin/cases`, `GET /admin/cases/page/{page}`, and
`GET`/`POST /admin/cases/{streamId}`. A write body is
`{ schemaVersion: 1, commandId, expectedRevision, command }`; command schemas
live in `@animal-helper/contracts`. Queue responses include `nextPage`, or
`null` when exhausted. Case responses include the current workspace `revision`.
Lifecycle changes and workspace writes are atomic and stale revisions
return 409. Accepted commands can be retried with the same ID and content.

`POST /admin/cases/search` accepts
`{ schemaVersion: 1, page, query, reporterEmail, ownerEmail }`. Search fields
default to empty strings and combine with AND. General text searches case
number, species key/Slovak label, place, next step, situation key/Slovak label,
and both email fields. Reporter email uses the latest retained contact;
superseded, missing and purged addresses do not match a nonempty email search.

All admin text searches use the pure `@animal-helper/search` matcher: case and
accent insensitive literal substrings, whitespace-separated terms in any order,
and bounded typo tolerance including adjacent swaps. Terms with fewer than four
letters/digits stay literal, four to seven permit one edit, and eight or more
permit two. Every term must match a field. SQL wildcards have no special
meaning. Searches retain the queue's chronological order.

Filtering runs before pagination (100 cases per page). The server scans bounded
batches in a repeatable-read snapshot, using the same matcher as guidance and
directory screens rather than a separate SQL search implementation. This avoids
a second persistent index of private contact data. Empty filters retain direct
SQL pagination. Search text stays in the request body, outside URLs and audit
metadata. This read requires an operator session and the same trusted-origin
check as other admin POST requests.

`POST /admin/guidance/contacts` accepts `{ expectedHash, kindKey, options }`,
where each option has `{ id, serviceKey, title, body, enabled }`. IDs must be
unique within the list and remain stable through reorder; at least one option
must be enabled. The complete contact list replaces the selected kind's legacy
primary/secondary/volunteer instructions atomically with the draft hash update
and audit record. Concurrent/stale replacements return 409. Drafts can contain
unfinished copy; publication requires a nonempty heading, instructions and a
valid service for every enabled option. Text follows the existing guidance
safety rules.

Options reuse `ah.guidance_cells` with `contact.option.{id}` instruction keys,
generic `contact.title`/`contact.body` slots and explicit sort order. Existing
published guidance remains unchanged until saved and published. Directory
releases retain the published options, and guidance releases retain the
published directory. No database schema migration is required.

After reporter submission, an identical `submit_draft` can recover its original
acknowledgement. The adapter accepts only an already recorded command in that
path; the read-only capability cannot apply a new mutation.

Production Vercel builds bundle the API and backoffice, then apply checksummed
database migrations before the deployment receives traffic. The build requires
`DATABASE_ENVIRONMENT=production`, `DATABASE_SSL_MODE=verify`, and the direct
`DATABASE_MIGRATION_URL` in Vercel's production environment. Preview builds do
not run migrations. Keep release migrations backward-compatible with the
currently deployed API.

The committed `api/index.mjs` entry lets Vercel detect the function before the
build runs; it imports the generated `dist/vercel-entry.mjs` bundle.

Account management uses `GET`/`POST /admin/operators/invitations` and
`POST /admin/operators/invitations/{invitationId}/revoke`. Permission is checked
against the current operator record on every request. Writes require a session
authenticated within five minutes; `/admin/auth/reauth/options` and `/verify`
perform a passkey assertion bound to the current account and session, rotate the
session cookie, and revoke the previous session. Invitation generation is
limited to 20 per manager in 15 minutes. Mutations and their audit records
commit together. `GET /admin/operators/accounts` lists enabled, enrolled
accounts. `POST /admin/operators/accounts/{operatorId}/management` accepts
`{ canManageOperators, expectedCanManageOperators }` and grants/revokes
management permission after fresh authentication. Self-changes are rejected;
concurrent changes serialize and recheck the actor's current permission. Audit
records keep the target account in `target_operator_id`, separate from case
streams. The maintenance command remains available for initial setup and
recovery.

Veterinary contact options optionally include
`clinicVariant: "standard" | "protected"` (W18/W19). Omitted values preserve
existing standard behaviour. Variants persist through draft edits and immutable
publications and are part of the content hash. Protected report profiles must
target a specific animal; the app does not infer protected status from a name or
apply it to unidentified road reports. The migration
`20261027190000_operator_roles_and_clinic_variants.sql` must be applied before
deploying this API.
