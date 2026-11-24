import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  createCaseSession,
  createMemoryCaseStore,
} from "@animal-helper/client";
import {
  syntheticContactPayload,
  syntheticFormSnapshot,
  syntheticLocationPayload,
  type ContactPayloadV1,
} from "@animal-helper/contracts";
import { createApiHandler } from "../src/handler.js";
import { createMemoryGateway } from "../src/memory-gateway.js";

const now = new Date("2026-10-21T12:00:00.000Z");
const harness = (drop?: "before" | "after") => {
  const handle = createApiHandler({
    gateway: createMemoryGateway(),
    pepper: randomBytes(32),
    now: () => now,
  });
  const store = createMemoryCaseStore();
  const contacts: ContactPayloadV1[] = [];
  const submitIds: string[] = [];
  let dropped = false;
  const session = createCaseSession({
    store,
    now: () => new Date("2099-01-01T00:00:00Z"),
    transport: {
      async sendCommand({ command, authorization }) {
        if (command.type === "submit_draft") {
          submitIds.push(command.commandId);
          if (drop === "before" && !dropped) {
            dropped = true;
            throw new Error("offline");
          }
        }
        const response = await handle({
          method: "POST",
          pathname: "/commands",
          search: "",
          origin: undefined,
          authorization,
          body: command,
        });
        if (
          command.type === "attach_private_data" &&
          command.kind === "contact" &&
          response.status === 200
        )
          contacts.push(command.privatePayload);
        if (command.type === "submit_draft" && drop === "after" && !dropped) {
          dropped = true;
          throw new Error("lost acknowledgement");
        }
        return response;
      },
      getStatus: ({ authorization }) =>
        handle({
          method: "GET",
          pathname: "/status",
          search: "",
          origin: undefined,
          authorization,
          body: undefined,
        }),
    },
  });
  const ready = async () => {
    expect((await session.openDraft()).ok).toBe(true);
    expect((await session.attachLocation(syntheticLocationPayload)).ok).toBe(
      true,
    );
    expect((await session.attachFormSnapshot(syntheticFormSnapshot)).ok).toBe(
      true,
    );
  };
  return { session, store, contacts, submitIds, ready };
};
const corrected: ContactPayloadV1 = {
  ...syntheticContactPayload,
  email: "corrected@example.invalid",
  shareWithAuthorities: false,
  newsletter: false,
};
const original: ContactPayloadV1 = {
  ...syntheticContactPayload,
  shareWithAuthorities: true,
  newsletter: true,
};

it("replaces contact and consent choices before retrying a submission that never reached the server", async () => {
  const { session, contacts, ready } = harness("before");
  await ready();
  expect(await session.submit(original)).toMatchObject({
    ok: false,
    error: { code: "NETWORK_FAILURE" },
  });
  expect(await session.submit(corrected)).toMatchObject({
    ok: true,
    value: { publicState: "received", pendingCount: 0 },
  });
  expect(contacts).toEqual([original, corrected]);
});

it("recovers the same submission after an ambiguous acceptance without duplicating it", async () => {
  const { session, contacts, submitIds, ready } = harness("after");
  await ready();
  expect((await session.submit(original)).ok).toBe(false);
  expect(await session.submit(original)).toMatchObject({
    ok: true,
    value: { publicState: "received" },
  });
  expect(new Set(submitIds).size).toBe(1);
  expect(contacts).toEqual([original]);
});

it("does not claim changed contact or consent was accepted when the original report already committed", async () => {
  const { session, contacts, ready } = harness("after");
  await ready();
  expect((await session.submit(original)).ok).toBe(false);
  expect(await session.submit(corrected)).toMatchObject({
    ok: false,
    error: { code: "CASE_READ_ONLY" },
  });
  expect(contacts).toEqual([original]);
  expect(await session.snapshot()).toMatchObject({
    publicState: "received",
    mutationAllowed: false,
    pendingCount: 0,
  });
});

it("rejects incomplete reports without poisoning the queue and accepts a completed anonymous report", async () => {
  const { session, ready } = harness();
  await ready();
  // A separate empty case exercises server validation through the real client.
  await session.removeLocal();
  await session.openDraft();
  expect(await session.submit()).toMatchObject({
    ok: false,
    error: { code: "API", apiCode: "INCOMPLETE_REPORT" },
  });
  expect(await session.snapshot()).toMatchObject({
    pendingCount: 0,
    mutationAllowed: true,
  });
  await session.attachLocation(syntheticLocationPayload);
  await session.attachFormSnapshot(syntheticFormSnapshot);
  expect(
    await session.submit({
      schemaVersion: 1,
      shareWithAuthorities: false,
      newsletter: false,
    }),
  ).toMatchObject({ ok: true, value: { publicState: "received" } });
});

it("uses server timestamps even when the device clock says 2099", async () => {
  const { session, store, ready } = harness();
  await ready();
  await session.refreshStatus();
  expect((await store.load())?.lastPublicStatus).toMatchObject({
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
});

it("editing report details cancels a queued submission before flushing the edit", async () => {
  const { session, ready, submitIds } = harness("before");
  await ready();
  expect((await session.submit(original)).ok).toBe(false);
  const correctedForm = {
    ...syntheticFormSnapshot,
    situationType: "dead" as const,
    condition: { symptoms: [] },
    dead: { suspiciousSigns: ["bait" as const] },
  };
  expect(await session.attachFormSnapshot(correctedForm)).toMatchObject({
    ok: true,
    value: { publicState: "draft" },
  });
  expect(submitIds).toHaveLength(1);
  expect(await session.submit(corrected, correctedForm)).toMatchObject({
    ok: true,
    value: { publicState: "received" },
  });
});

it("rejects edits when a queued submission was already accepted", async () => {
  const { session, ready } = harness("after");
  await ready();
  expect((await session.submit(original)).ok).toBe(false);
  expect(
    await session.attachLocation({
      ...syntheticLocationPayload,
      address: "Changed private location",
    }),
  ).toMatchObject({ ok: false, error: { code: "CASE_READ_ONLY" } });
});
