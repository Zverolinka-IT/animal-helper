# Client

Framework-free reporter command client. Vue screens project this state and call
these methods; they do not own retries, capabilities, or `expectedVersion`. See
the [UI cookbook](../../docs/product/ui-cookbook.md).

The package is browser-safe (Web Crypto, no Node APIs). `createIdbCaseStore`
from `@animal-helper/client/browser` keeps the case id, capability, queue, and
last public status in IndexedDB. Tests use the memory store, which resets when
the page is discarded. The root entry stays free of browser storage types so
Node projects can typecheck it.

```ts
import {
  createCaseSession,
  createFetchTransport,
  createMemoryCaseStore,
} from "@animal-helper/client";

const session = createCaseSession({
  store: createMemoryCaseStore(),
  transport: createFetchTransport({
    baseUrl: "http://127.0.0.1:8787",
  }),
});

await session.openDraft();
await session.attachLocation({
  schemaVersion: 1,
  address: "Synthetic testerska 1",
});
await session.attachFormSnapshot({
  schemaVersion: 1,
  situationType: "injured",
  species: { source: "skipped" },
  condition: { symptoms: ["unknown"] },
  mediaRecordIds: [],
});
await session.submit({
  schemaVersion: 1,
  shareWithAuthorities: false,
  newsletter: false,
});
```

Durability labels: `device_only`, `queued`, `acknowledged`, `received`,
`closed`, `needs_attention`. Snapshots never include the capability. Importing a
capability from a URL fragment is status-only until the API exposes a stream
version.

Command HTTP replies still acknowledge persistence. The next screen is a
separate walk-view document resolved locally in `@animal-helper/guidance` (and
optionally echoed as `walkView` on `CommandAccepted`). Vue must not treat a
missing HTTP `walkView` as a blocked walk.

`VERSION_CONFLICT` is not retried by bumping `expectedVersion`. That would
change the command body after a possible accept.

The client commits the capability and exact command envelope to its local store
before making a request, and saves each acknowledgement before continuing the
queue. A storage failure returns `STORAGE_UNAVAILABLE` without sending an
unrecoverable command. Once submission is acknowledged, remaining queued draft
mutations are discarded. Retrying a lost submit acknowledgement uses the same
recorded command ID after the server makes the capability read-only.

`submit(contact, finalSnapshot?)` durably queues the optional final form
snapshot, contact choices and submission together. The customer uses the final
snapshot to preserve the reported outcome and failure reasons as private data.
An unchanged retry keeps the original command IDs. Changed report details,
contact or consent choices supersede the pending submission only while the
report is still a draft. If an earlier submission already committed, the method
returns `CASE_READ_ONLY`; it never claims those changed choices were saved.

Case operations serialize across sessions sharing a store. The IndexedDB store
uses the Web Locks API to share this lock across browser tabs and refuses
mutations when that API is unavailable. A custom persistent store should provide
`exclusive` to coordinate all instances that share its backend. Fetch requests
time out after 12 seconds so an unreachable server cannot hold the lock forever.
