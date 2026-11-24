# Contacts — working presentation contract

The shared [instructions renderer](instructions-contract.md) accepts ordered `blocks`. Published guidance supplies
instruction text and typed service keys; its optional `contactDirectory` contains an immutable administrator-published
snapshot. The jurisdiction resolver filters that snapshot by service, administrator-defined territory and review
deadline, then sorts contacts by straight-line distance. It does not infer new advice or substitute out-of-area
organizations.

Contact options use stable `contact.option.{id}` instruction keys, generic `contact.title`/`contact.body` slots, and a
typed directory service. Their order defines a sequence of `/contacts/{id}` steps rendered with the existing contact
page. Disabled options are omitted; missing directory matches keep the option's instructions and show the existing
unavailable notice. The last option continues to the existing self-help or report-contact step for that animal's flow.

Customer walks keep their guidance snapshot and current guide path in the local checkpoint after animal details are
saved. New publications do not reorder an in-progress walk, including after a reload. Back navigation distinguishes
options by path, and returning from the reporter-contact form restores the option the user came from. Legacy
publications keep their existing screen paths and behaviour.

The Admin `/contacts` editor supplies names, telephone/HTTPS website, addresses, optional coordinates, exact GeoJSON
boundaries or regional coverage, opening hours, notes and verification metadata. Customer coordinates stay on the device
for selection. Missing/unverified/expired contacts show an unavailable state. Draft and disabled entries never enter the
public snapshot. Hours use Slovak local time and support overnight shifts; availability and review expiry refresh every
minute while the screen is open. Unknown hours are labelled as unverified.

Cards support optional address, distance, opening status (open/closing/closed/unknown), telephone, website, notes and
navigation. Call links normalize telephone numbers. Navigation uses coordinates or the published address. Notices
support `important` (pale yellow) and `critical` (solid yellow). Instructions contain a heading and stable-ID list
items. The link block supports the volunteer variant. All text is plain text, never injected HTML.

Component-preview fixtures cover W15 municipality, W18 clinics, W20 police, W21 volunteers, and W36 motorway patrol. W22
self-help is described in [the self-help contract](self-help-contract.md). The old W15 fixture contains a combined
showcase with namespaced IDs. Runtime presentation replaces sample contact cards, including on branches that still lack
a persisted case workflow. Individual fixtures remain available for component tests in isolation.

Phone links only allow tel numbers; other links only allow HTTP(S) without credentials. Fixtures intentionally have no
live phone/navigation/volunteer links. Their wording and addresses are placeholders, not verified emergency, medical, or
legal guidance. The ordered `footerActions` array defines visible buttons, labels, appearance and destinations. The demo
alternatives action opens W22; the resolved action opens W24 without submitting anything. Back has a data-defined
target. The optional `advice` payload contains the trigger label, locale, dialog labels and full ordered advice blocks
(see `instructions-contract.md`). It is supplied with this page, not recovered from a previous page or global fallback.
Omitting it hides the advice action. Below 768px it opens a bottom sheet; on desktop it opens a centered dialog, without
navigation or a stepper. The same renderer supports red-only and combined red/green advice. The mobile sheet is capped
below the measured app header; both presentations scroll internally, lock the background, trap focus and restores focus
to its trigger. Escape, backdrop, close controls and acknowledgement dismiss it. Motion respects reduced-motion. Case
workflow guards and server authorization remain separate from public contact-directory presentation.
