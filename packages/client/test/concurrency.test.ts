import { expect, it } from "vitest";
import { createIdbCaseStore } from "../src/idb-case-store.js";
import {
  createCaseSession,
  createMemoryCaseStore,
  type ApiTransport,
  type TransportResponse,
} from "../src/index.js";

const accepted = (version: number): TransportResponse => ({
  status: 200,
  body: {
    ok: true,
    value: {
      outcome: "applied",
      committedVersion: version,
      publicState: "draft",
    },
  },
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it("refuses to send when cross-tab locking is unavailable", async () => {
  let sent = false;
  const session = createCaseSession({
    store: createIdbCaseStore({} as IDBFactory),
    transport: {
      sendCommand: () => {
        sent = true;
        return Promise.resolve(accepted(1));
      },
      getStatus: () => Promise.resolve({ status: 404, body: undefined }),
    },
  });
  expect(await session.openDraft()).toEqual({
    ok: false,
    error: { code: "STORAGE_UNAVAILABLE", retryable: false },
  });
  expect(sent).toBe(false);
});

it("serializes two sessions, including a delayed failed send and its retry", async () => {
  const store = createMemoryCaseStore();
  const started = deferred<undefined>();
  const release = deferred<undefined>();
  let first = true;
  let version = 0;
  const transport: ApiTransport = {
    async sendCommand({ command }) {
      if (command.type === "attach_private_data" && first) {
        first = false;
        started.resolve(undefined);
        await release.promise;
        throw new Error("offline");
      }
      expect(command.expectedVersion).toBe(version);
      return accepted(++version);
    },
    getStatus: () => Promise.resolve({ status: 404, body: undefined }),
  };
  const a = createCaseSession({ store, transport });
  const b = createCaseSession({ store, transport });
  await a.openDraft();
  const firstWrite = a.attachText({ note: "A" });
  await started.promise;
  const secondWrite = b.attachText({ note: "B" });
  release.resolve(undefined);
  expect((await firstWrite).ok).toBe(false);
  expect((await secondWrite).ok).toBe(true);
  expect(await b.snapshot()).toMatchObject({
    expectedVersion: 3,
    pendingCount: 0,
  });
  expect((await store.load())?.acknowledgedCommandIds).toHaveLength(3);
});

it("keeps newer acknowledgements when status refresh and attachment overlap", async () => {
  const store = createMemoryCaseStore();
  const started = deferred<undefined>();
  const status = deferred<TransportResponse>();
  const session = createCaseSession({
    store,
    transport: {
      sendCommand: ({ command }) =>
        Promise.resolve(accepted(command.expectedVersion + 1)),
      getStatus: () => {
        started.resolve(undefined);
        return status.promise;
      },
    },
  });
  await session.openDraft();
  const refresh = session.refreshStatus();
  await started.promise;
  const write = session.attachText({ note: "New data" });
  const record = await store.load();
  status.resolve({
    status: 200,
    body: {
      ok: true,
      value: {
        streamId: record?.streamId,
        publicState: "draft",
        createdAt: "2026-10-21T12:00:00.000Z",
        updatedAt: "2026-10-21T12:00:00.000Z",
      },
    },
  });
  expect((await refresh).ok).toBe(true);
  expect((await write).ok).toBe(true);
  expect(await session.snapshot()).toMatchObject({
    expectedVersion: 2,
    pendingCount: 0,
  });
  expect((await store.load())?.acknowledgedCommandIds).toHaveLength(2);
});

it("does not resurrect a case when cleanup overlaps an in-flight write", async () => {
  const release = deferred<undefined>();
  const started = deferred<undefined>();
  const store = createMemoryCaseStore();
  const session = createCaseSession({
    store,
    transport: {
      async sendCommand({ command }) {
        if (command.type === "attach_private_data") {
          started.resolve(undefined);
          await release.promise;
        }
        return accepted(command.expectedVersion + 1);
      },
      getStatus: () => Promise.resolve({ status: 404, body: undefined }),
    },
  });
  await session.openDraft();
  const write = session.attachText({ note: "A" });
  await started.promise;
  const clear = session.removeLocal();
  release.resolve(undefined);
  await write;
  await clear;
  expect(await store.load()).toBeUndefined();
});

it("refuses edits and cleanup from a tab still bound to a replaced case", async () => {
  const store = createMemoryCaseStore();
  const transport: ApiTransport = {
    sendCommand: ({ command }) =>
      Promise.resolve(accepted(command.expectedVersion + 1)),
    getStatus: () => Promise.resolve({ status: 404, body: undefined }),
  };
  const a = createCaseSession({ store, transport });
  const b = createCaseSession({ store, transport });
  await a.openDraft();
  await b.removeLocal();
  await b.openDraft();
  const newCase = await b.snapshot();
  expect(await a.attachText({ note: "Old case" })).toMatchObject({
    ok: false,
    error: { code: "CASE_ALREADY_OPEN" },
  });
  await a.removeLocal();
  expect(await b.snapshot()).toEqual(newCase);
});

it("allows only one concurrent draft creation for a shared store", async () => {
  const store = createMemoryCaseStore();
  const transport: ApiTransport = {
    sendCommand: ({ command }) =>
      Promise.resolve(accepted(command.expectedVersion + 1)),
    getStatus: () => Promise.resolve({ status: 404, body: undefined }),
  };
  const results = await Promise.all([
    createCaseSession({ store, transport }).openDraft(),
    createCaseSession({ store, transport }).openDraft(),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual([
    { ok: false, error: { code: "CASE_ALREADY_OPEN", retryable: false } },
  ]);
});
