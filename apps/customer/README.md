# Customer

All five report types now submit through the command API and survive reloads. See
[the current guidance architecture](../../docs/architecture/administered-guidance-flow.md#all-report-flows-2026-10-22)
for branching, admin configuration, publication pinning, and retry behavior. The older preview notes below describe the
initial UI build; they are not the current persistence contract. The map still uses explicit sample locations and device
coordinates, and binary media upload/AI identification remain separate.

Vue 3 + TypeScript + Pug + Tailwind 4. Technical foundation, not the finished reporting flow or Figma design. Tool
versions match the monorepo.

From the repository root:

```sh
pnpm install
pnpm --filter @animal-helper/customer dev
```

Open http://localhost:5173. Root `pnpm dev` also starts this app alongside the existing API, backoffice and database
setup.

```sh
pnpm --filter @animal-helper/customer typecheck
pnpm --filter @animal-helper/customer build
pnpm --filter @animal-helper/customer lint
pnpm --filter @animal-helper/customer lint:fix
pnpm --filter @animal-helper/customer format
pnpm --filter @animal-helper/customer format:fix
pnpm --filter @animal-helper/customer test:unit
pnpm --filter @animal-helper/customer test:unit --run
pnpm --filter @animal-helper/customer test:unit:coverage
pnpm --filter @animal-helper/customer exec playwright install chromium webkit
pnpm --filter @animal-helper/customer test:e2e
pnpm --filter @animal-helper/customer test:e2e:ui
```

`format` checks formatting; `format:fix` writes changes. This differs from the repository-root `format`, which writes.
`lint` uses a local cache; `lint:fix` applies available fixes. `test:unit` starts watch mode locally; add `--run` for a
single run. Coverage reports are written to `coverage`, and E2E UI mode opens the interactive Playwright runner. `build`
checks types before bundling; `build-only` runs just Vite. The existing two-project typecheck is retained for both Vue
and Node configuration files. The `dev` host and port are defined in Vite configuration.

The shared root `prettier.config.mjs`, `eslint.config.mjs` and `.editorconfig` are the source of truth. Customer-only
overrides preserve the B2B conventions without changing backend rules. Customer scripts use these same shared configs.
Root formatting and linting include customer directly; recursive tests discover its `test` script (a single run),
alongside the other workspace packages. Root typecheck and build continue to include customer as well.

Unit tests live in local `__tests__` folders next to their modules and use the `.spec.ts` suffix (for example,
`src/libs/components/__tests__/base-icon.spec.ts`). E2E tests live in `e2e/tests` with the same suffix.

E2E starts only customer on port 5183 and runs Chromium and WebKit, without an API or database. Production hosting must
serve index.html for unknown URLs to support Vue Router history mode.

## Layers

| Folder          | Responsibility                                                     |
| --------------- | ------------------------------------------------------------------ |
| `src/app`       | Root app, pages, routes and application-specific components        |
| `src/libs`      | General base components, directives, composables and utilities     |
| `src/providers` | Application services; currently Vue Router                         |
| `src/plugins`   | Third-party integration configuration; currently OverlayScrollbars |
| `src/assets`    | Tailwind entry point and original SVG icons                        |
| `src/types`     | Global component declarations                                      |

Create additional folders only when needed. The `@` alias points to `src`. Pinia, i18n, API clients, form libraries, PWA
and live server-driven navigation are intentionally absent. VueUse core is available. The previous implementation is
available in Git history; the current preview flows are described in [fixture-flow.md](docs/fixture-flow.md).

## Component conventions

Use kebab-case filenames, `<script setup lang="ts">` and `<template lang="pug">`. Semantic classes use Pug dot notation;
Tailwind utilities belong in `class` or `:class`. Semantic classes do not require separate CSS rules.

```pug
section.report-location(class="flex flex-col gap-6 p-4")
  AppHeader
  base-icon.report-location__icon(
    name="search",
    class="size-6"
  )
```

`attachLibs(app)` eagerly registers `libs/components/**/base-*.vue` globally. Use them in kebab-case without imports.
Add their types to `src/types/components.d.ts` for template prop checking and completion. Ordinary components require
explicit imports and PascalCase tags.

Directives in `libs/directives/**/*.ts` use a default Vue directive export and are registered under their kebab-case
filename: `click-outside.ts` becomes `v-click-outside`. Tests and declaration files are excluded. Duplicate component or
directive names fail startup. Keep helpers outside the directives folder. No speculative directives are added.

Customer formatting follows B2B: 120-character lines, single quotes in scripts, no semicolons or trailing commas, and no
parentheses around a single arrow parameter. Imports are organized automatically, without removing unused imports;
ESLint reports those instead. These settings are scoped to customer, not the backend or backup app. EditorConfig keeps
editor indentation and line endings aligned with the formatter.

Prettier preserves class notation (`pugClassNotation: as-is`), uses double quotes in Pug and wraps attributes above one
attribute. Tailwind class sorting is enabled. The semantic/utility distinction is a documented convention, not a custom
lint rule. Vue/Pug lint rules apply only to this customer package. Use the Vue Official editor extension; the Pug
language plugin is configured in tsconfig. ESLint includes Vitest and Playwright rules for their respective test
folders. The final Prettier compatibility config disables conflicting formatting rules; formatting is checked separately
from code correctness.

## Tailwind and icons

Tailwind includes Preflight and its default utilities, extended by `src/assets/css/theme.css`. The Figma foundations use
self-hosted Roboto (Latin and Latin Extended, including Slovak), semantic colors (`bg-canvas`, `text-ink`, `bg-primary`,
`border-line`), typography (`text-heading-1`, `text-body`, `text-body-strong`, `text-button`, `text-small`),
`rounded-control`, `shadow-brand` and `bg-primary-gradient` / `bg-accent-gradient`. Typography utilities include line
height and font weight. No remote font requests are made.

Source: [UI Kit Style Guide](https://www.figma.com/design/Y6LY2VRpRoxNKNJEQACH6Y/?node-id=2692-16570). The explicit
typography swatches take precedence over conflicting instances: Header 01 is 20/24px here (some components use 20/28px);
body text is Roboto 14/20px (one instance reports Inter). Heading/button tracking is -1%, not -1px. Radius is 16px. The
gradient swatch shadow is kept as `shadow-brand`; individual component effects can differ. Default Tailwind spacing and
breakpoints remain unchanged because no global replacement scale has been established. Pale/muted colors are not
intended as accessible body text.

Implement screens in place first. Extract shared or screen-specific components when actual reuse or complexity justifies
it; the theme does not prescribe a component library. Styling uses utility classes first.

The 50 original SVGs from the previous Figma export live in `src/assets/icons`. Their source-node mapping is recorded in
`src/assets/icons/manifest.json`. `vite-plugin-svg-icons-ng` generates symbols with IDs `icon-[name]` and injects them
into HTML. Add or edit an SVG and Vite updates it automatically; no icon build command or committed generated sprite is
needed. SVG optimization is disabled to preserve geometry and colors; the baker still rewrites local IDs and references.
Only trusted, reviewed SVGs belong here; this pipeline is not an upload sanitizer.

The four social icons use the blue Figma variants, with their white background paths removed by design agreement.

`base-icon` takes `name: string` (SVG filename without extension) and optional `label`. It defaults to a decorative 24px
icon. For meaningful standalone icons, provide a label; for icon-only buttons, label the button instead. Override size
with `size-*`. The 54 monochrome icons use `currentColor`, so `text-*` sets their color. Only `place-on-map` preserves
its multiple original colors; brand logos remain separate with their original colors. Unknown names render no icon;
verify names against the source files.

## App shell

The shell, header and splash fill the viewport. Main content is fluid up to 640px and centered on desktop; this width is
a provisional responsive adaptation, not a desktop Figma specification. The drawer opens at the left viewport edge and
remains at most 324px wide, leaving room for dismissal on small screens. The shell includes original Figma logo exports,
a brief branding splash (skipped with reduced motion), header, left drawer and social footer. The drawer uses a native
modal dialog with keyboard focus cycling, Escape/backdrop dismissal and focus restoration. Its navigation scrolls
independently on short screens. Device status bars in the designs are not reproduced in the web app.

Sources: splash `2121:14081`, home `2120:13017`, drawer `2120:13345` in the Figma file linked above. Logo exports:
yellow `2121:14082`, orange `1589:12316`. Original logo paths are preserved. An SVG mask and a small eyelid path animate
a 420ms blink: once on the splash, every 30 seconds on the orange logo. Reduced motion disables blinking. Screen content
fades out over 100ms and enters over 250ms with an 8px upward movement, while the header stays fixed in size. Reduced
motion disables these transitions. Full-width white content blocks have rounded corners only above the content's 640px
maximum width; at or below that width they meet the viewport with square corners.

Home now renders a typed local fixture from `src/app/pages/fixtures/home.ts`, passed as route props to W01 at `/`.
`home-view.ts` is a temporary frontend presentation model, not the shared API contract. All homepage copy, choice
labels, accordion content and allowed action IDs come from this object; the component does no translation. CTA clicks
emit an action ID and show a fixture notice, without network requests or navigation to unimplemented steps. Accordion
bodies are explicitly labelled sample copy, not approved legal or contact information. Social actions are disabled.
Injured and stray starts, location, animal details and contact submission go through the walk adapter in
`src/app/walk/adapter.ts` and persist public case status on the API. The walk view still chooses the next screen for
those commands. Dead, cruelty and other situations stay on the local fixture provider. No generic form engine is
introduced.

Persisted injured walks render the fetched or bundled species guidance in the advice, contact, self-help and
advice-drawer views. Subsequent guidance navigation uses the shared resolver and skips disabled or empty optional steps;
secondary contact W19 has a renderer. Empty or incomplete public guidance is rejected in favour of bundled content. The
remaining fixture branches cannot report successful submission: their submit action explains that sending is
unavailable.

In development, `/?fixture=draft` selects the W01 draft-card fixture (Figma `2120:13168`). Plain `/` has no draft. The
optional `props.draft` supplies the summary, progress and actions. Resume opens the fixture location step; Complete only
shows a preview notice. Neither changes a real report. Production ignores the preview query parameter.

### Location preview

The five homepage choices and draft Resume open `/w03` with an in-memory fixture session. The step hides the hamburger
and homepage footer, renders Back and progress from its fixture, and permits entry only after the preview session is
prepared. Reload/direct entry returns Home; this is a preview guard, not backend authorization. All five choices share
this temporary transition, which is not a specification of the eventual server flow.

The map is the Figma illustration from `2127:15214`, clearly marked as a mock. Clicking it selects the named fixture
location, not coordinates corresponding to the clicked pixel. Search filters three local samples with accent-insensitive
matching. Device geolocation runs only on explicit request; denial/timeouts are handled, and no coordinates are sent to
Google or the API. Confirm stores the selection only in memory and opens the local media step. No Google credentials or
B2B keys are reused. B2B's `vue3-google-map` and `@googlemaps/js-api-loader` can be integrated once project credentials
are available; neither unused dependency is installed in this preview.

### Media preview

`/w04` requires an in-memory selected location. It implements the W04 empty state and W05-style selected-file grid from
Figma, using the same local page rather than claiming a server-driven transition. A single gallery input selects local
files; any camera option is provided by the system picker, depending on browser/device support. Images and videos use
temporary object URLs, revoked on removal/unmount. File objects survive Back within the preview session, but not reload
or a new report. There is no file-count limit; the temporary restrictions are 20 MB per file and
JPEG/PNG/WebP/MP4/WebM/MOV MIME types. These are not backend policy or security validation. Confirm and manual
identification only show explanatory notices: no upload, AI request, recognition result or subsequent details screen is
implemented. Copy and limits live in the media fixture.

The shared toast manager supports success, error, warning and info variants with a title, description and optional
action/timer. Media removals share one eight-second undo group; further removals reset the timer, and undo restores the
group's original ordering. Dismissal, expiry or leaving the screen clears that group. Focus and a hidden browser tab
pause the countdown; hovering does not. Errors remain until dismissed or the screen is disposed. Toasts sit above the
media actions. The header and step actions are sticky; the header blurs underlying content and the footer fades content
into its background. Empty/grid changes and grid reordering animate unless reduced motion is requested.

Home and My cases both lead to Home temporarily. FAQ, volunteering and donation are disabled; social actions display an
unavailable notice until their destinations are agreed. The splash is not an API loading indicator. Screen identifiers
and transitions must be reconciled with the backend contract before integration.

## Scrollbar behavior

`attachPlugins()` configures shared defaults before mounting. The root app uses deferred body initialization and
`autoHide: scroll`. Initialization is cancelled when native overlay scrollbars exist or when body initialization would
interfere with native behavior. This uses feature detection, not a Safari check. The official composable cancels pending
work and destroys its instance on unmount.

Use `OverlayScrollbarsComponent` directly for internal areas. Shared cancellation defaults apply there too; keep
`overflow-auto` on the bounded root so it remains scrollable when initialization is cancelled. No `base-scroll-area`
wrapper exists. Router navigation restores saved scroll on history traversal and otherwise starts at the top. The drawer
has square corners and shares the header logo position. Its opening animation lasts 300ms; the backdrop fades in over
150ms. Both animations are disabled when reduced motion is requested.
