# UI cookbook

Status: **working guide for customer PWA contributors**

Last reviewed: 2026-09-10

This is the frontend contract. Visual design lives in Figma; sequence and keys
live in the case matrices and `@animal-helper/guidance`. Vue screens stay thin
over `@animal-helper/client`. After a successful command (or skipping photo),
navigate with `continueWalkTo` / `resumeWalkView` — those return a walk-view
document. Do not hardcode the next route. The HTTP command ack may include
optional `walkView`; the PWA must keep walking from the local resolver when that
field is absent.

Read this before drawing or implementing a customer screen. Depth sits in:

- [ADR 0007](../architecture/decisions/0007-vue-static-pwas.md) — Vue static
  PWAs, thin views, no workflow engine;
- [ADR 0006](../architecture/decisions/0006-administered-guidance-flow.md) —
  fixed-schema guidance;
- [Screen map](case-matrices/screen-map.md) — W01–W26 vs current routes;
- [Client README](../../packages/client/README.md) — session methods.

## Stack

Vue 3 + TypeScript + Vue Router + Vite in `apps/customer`. No Nuxt, Next, or
server-rendered UI. Same Vue runtime will later preview this walk in the
backoffice, so avoid customer-only layout hacks that cannot run in a
non-interactive preview.

Keep the dependency set small. Ephemeral chrome may use Pinia; **case, queue,
and capability state must not**.

Local app: `npm run dev` from the repository root, then `http://127.0.0.1:5173`.
The backoffice is `http://localhost:5174`. The customer app keeps the open case
in IndexedDB and resumes it after reload. The memory store used by tests resets
when discarded.

## What you own

| You own                                                  | You do not own                                 |
| -------------------------------------------------------- | ---------------------------------------------- |
| Layout, interaction, accessibility, responsive behaviour | HTTP, retries, `expectedVersion`, capabilities |
| Vue screens in `apps/customer`                           | `@animal-helper/client`, event store, API      |
| Figma frames named with W-keys                           | When a new W-screen or branch is allowed       |
| Empty, error, offline, and skipped-photo states          | IndexedDB, signed uploads, object storage      |
| Chrome copy via i18n keys (with language review)         | Veterinary advice, authority directories       |

You contribute most by making the **walk usable and safe on a phone**, not by
talking to the server.

## Screens call the JS session, never HTTP

Do not use `fetch`, axios, `/commands`, or `Authorization` headers in a Vue
file. Create the session once (`customerSession()` in `runtime.ts`) and call
walk helpers or `CaseSession` methods.

Today the walk wrappers are:

| Route                 | Walk helper        | Session method                |
| --------------------- | ------------------ | ----------------------------- |
| `/w01`                | `confirmSituation` | `openDraft` (once)            |
| `/w03`                | `confirmLocation`  | `attachLocation`              |
| `/w04`                | `continueWalkTo`   | none — local continue         |
| `/w09`                | `confirmDetails`   | `attachFormSnapshot`          |
| `/w13`–`/w23`, `/w26` | `continueWalkTo`   | none — copy from walk view    |
| `/w24`                | `submitReport`     | `attachContact` then `submit` |

Pattern:

```ts
const result = await confirmLocation(customerSession(), payload);
if (!result.ok) {
  error.value = result.error.code;
  return;
}
rememberSnapshot(result.value);
patchWalkFacts({ hasLocation: true });
await continueWalkTo(router, CUSTOMER_PATHS.location);
```

`continueWalkTo` reads `walkViewAfterPath` (local catalog + guidance). Do not
`router.push` a neighbour path. Screen fixtures live in `walkViewFixtures`
(`@animal-helper/contracts`).

Payloads must satisfy `@animal-helper/contracts` (`FormSnapshotV1`,
`LocationPayloadV1`, `ContactPayloadV1`). Field names, lengths, and enums are
the schema; status codes are not.

Handle `Result`:

- `ok` — keep the snapshot and navigate;
- `error.code` — show chrome via i18n, do not invent a retry over HTTP.
  `NETWORK_FAILURE` is retryable (`flush` later). `VERSION_CONFLICT` is not
  retried by bumping `expectedVersion`.

Show durability from the snapshot, not from guessing the network:

`device_only` | `queued` | `acknowledged` | `received` | `closed` |
`needs_attention`

Labels already exist under `customer.durability.*` in `sk-SK`.

Later, photo **bytes** go through a client upload helper (signed URL), then
`attachMediaRef`. Guidance advice will be a loaded revision, not a command.
Neither is a raw API from Vue.

## Figma, matrices, and keys

- **Figma** is visual: type, spacing, components, states.
- **Matrices** are sequence: [screen map](case-matrices/screen-map.md). A frame
  that is not a W-key is a product change, not a styling change.
- **Walk view** is the reusable render contract: `screen`, `path`, `props`,
  `allowedCommands`, `fieldErrors`. Prepare pages against that schema.
- **Catalog keys** (`domestic_cat`, `sop_rescue`, `injured_companion`) are what
  the app stores and switches on. Labels can change; keys cannot.

Do not hardcode Slovak (or any user-visible string) in a component. Chrome,
validation, and accessibility text go in `@animal-helper/i18n`. Do/don't copy
and contact wording come from `GET /guidance` or the bundled fallback. Do not
paste matrix cells into Vue as a second source of truth.

Do not put telephone numbers in matrix-driven copy. Typed actions such as
`call-contact` refer to allow-listed directory keys.

## Safety and accessibility

Quality order is reporter/animal safety, then correctness, then looks.

- Emergency and “do not handle” content must be hard to miss on a ~360px phone.
- Large tap targets; visible focus; no information only in colour.
- The walk must remain usable when the network is bad: pending buttons,
  durability line, no silent failure.
- Do not bury 112 / 158 behind decoration.
- Fixtures, screenshots, and PRs: synthetic data only. No real reports, photos,
  phones, or addresses.

## Current walk

Implemented routes plus planned placeholders after an injured animal kind is
chosen. They work. They are not the design.

| Path         | Stands in for             | Notes                                                        |
| ------------ | ------------------------- | ------------------------------------------------------------ |
| `/w01`       | W01                       | Injured / stray only. Cruelty is catalogued, not selectable. |
| `/w03`       | W03a / W03b               | Collapsed to one address field.                              |
| `/w09`       | W04 + W09 + W11           | Photo skipped; injured walks pick a catalog kind.            |
| `/w14`, …    | planned W-screens         | Bundled or published copy on the catalogued screens.         |
| `/w24`       | reporter contact + submit | **Not** matrix W24 “who helped”.                             |
| `/thank-you` | thanks                    | Public status chrome.                                        |

`form_snapshot` v1 still accepts only `injured` and `stray`. The backoffice
matrix at `http://localhost:5174/guide` previews the same resolver, including
matrix-only W25.

## Start here

No schema change required:

1. Skin `/w01`, `/w03`, and `/thank-you` from approved Figma (mobile first).
2. Specify W03a (device location) vs W03b (address) as two layouts or two routes
   — then implement that choice.
3. Specify W04 photo: capture, six-file cap, skip, failure. Upload may stay
   unwired; the UI should exist.
4. Uncollapse W09 / W09b / W11: species search from the catalog, symptoms,
   consciousness/juvenile, free text. Bind **keys**, not labels.
5. Design W13/W14 as a do / don’t pattern. Do not rewrite veterinary advice.

Resolve on the first UI pass: **W24**. The PWA uses `/w24` for reporter identity
and submit. The matrices use W24 for “who helped” and W25 for “why help failed”.
Name the frames in Figma with W-keys before engineering splits the route.

## Do not start yet

- Cruelty (W02, W06) — snapshot schema rejects it.
- Live contact directories (W15–W21) — design cards that take a typed action and
  a label; numbers belong in a jurisdiction pack later.
- W22/W23 self-help — intro copy is imported where the matrix has it; numbered
  steps are still empty.
- Stray-specific content — rows are stubs.
- Install/offline PWA chrome beyond the durability line.
- Event store, capabilities internals, or guidance rollback.

## Pull requests

- One walk step or one component pattern per PR.
- `pnpm check` must pass.
- New user-visible strings: i18n keys, not literals.
- New W-screen or branch: catalog/schema first, then UI.
- Keep PRs free of case information.

Architecture and privacy boundaries are issues, not drive-by refactors. See
[Contributing](../../CONTRIBUTING.md).
