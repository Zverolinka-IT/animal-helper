import { describe, expect, it } from "vitest";

import {
  syntheticFormSnapshot,
  syntheticContactPayload,
  type FormSnapshotV1,
  type TransportCaseCommand,
} from "@animal-helper/contracts";

import {
  createCapability,
  createCaseSession,
  createMemoryCaseStore,
  encodeCapability,
  type ApiTransport,
  type TransportResponse,
} from "../src/index.js";

const applied = (
  committedVersion: number,
  publicState: "draft" | "received" | "closed" = "draft",
): TransportResponse => ({
  status: 200,
  body: {
    ok: true,
    value: {
      outcome: "applied",
      committedVersion,
      publicState,
    },
  },
});

const scriptedTransport = (
  send: (command: TransportCaseCommand) => TransportResponse | "offline",
): ApiTransport & { sent: TransportCaseCommand[] } => {
  const sent: TransportCaseCommand[] = [];

  return {
    sent,
    sendCommand: ({ command }) => {
      sent.push(command);
      const response = send(command);
      if (response === "offline") {
        return Promise.reject(new Error("offline"));
      }

      return Promise.resolve(response);
    },
    getStatus: () =>
      Promise.resolve({
        status: 200,
        body: {
          ok: true,
          value: {
            streamId: "018f1a50-7c3b-7000-8000-000000000001",
            publicState: "received",
            createdAt: "2026-08-22T12:00:00.000Z",
            updatedAt: "2026-08-22T12:00:00.000Z",
          },
        },
      }),
  };
};

describe("case session", () => {
  it.each(["form_snapshot", "contact", "submit_draft"])(
    "retries the complete report intent after a failure at %s and a reload",
    async (phase) => {
      const store = createMemoryCaseStore();
      let failed = false;
      const transport = scriptedTransport((command) => {
        if (
          !failed &&
          (command.type === phase ||
            (command.type === "attach_private_data" && command.kind === phase))
        ) {
          failed = true;
          return "offline";
        }
        return applied(
          command.expectedVersion + 1,
          command.type === "submit_draft" ? "received" : "draft",
        );
      });
      const form: FormSnapshotV1 = {
        ...syntheticFormSnapshot,
        outcome: {
          status: "unresolved",
          reasons: ["other"],
          otherText: "Synthetic failure",
        },
      };
      const first = createCaseSession({ store, transport });
      await first.openDraft();
      expect((await first.submit(syntheticContactPayload, form)).ok).toBe(
        false,
      );
      const record = await store.load();
      if (!record) throw new Error("expected durable report intent");
      const queued = record.queue;
      const beforeRetry = transport.sent.length;
      const reloaded = createCaseSession({ store, transport });
      const { schemaVersion, ...fields } = structuredClone(form);
      expect(
        (
          await reloaded.submit(structuredClone(syntheticContactPayload), {
            ...fields,
            schemaVersion,
          })
        ).ok,
      ).toBe(true);
      expect(transport.sent.slice(beforeRetry)).toEqual(queued);
      expect((await reloaded.snapshot())?.expectedVersion).toBe(4);
    },
  );

  it("supersedes an unacknowledged outcome even when contact data is unchanged", async () => {
    let failed = false;
    const transport = scriptedTransport((command) => {
      if (command.type === "submit_draft" && !failed) {
        failed = true;
        return "offline";
      }
      return applied(
        command.expectedVersion + 1,
        command.type === "submit_draft" ? "received" : "draft",
      );
    });
    const session = createCaseSession({
      store: createMemoryCaseStore(),
      transport,
    });
    await session.openDraft();
    expect(
      (
        await session.submit(syntheticContactPayload, {
          ...syntheticFormSnapshot,
          outcome: { status: "unresolved", reasons: ["escaped"] },
        })
      ).ok,
    ).toBe(false);
    const oldSubmit = transport.sent.at(-1);
    if (!oldSubmit) throw new Error("expected submission attempt");
    const corrected: FormSnapshotV1 = {
      ...syntheticFormSnapshot,
      outcome: { status: "resolved", reasons: [] },
    };
    expect((await session.submit(syntheticContactPayload, corrected)).ok).toBe(
      true,
    );
    expect(transport.sent.at(-3)).toMatchObject({
      kind: "form_snapshot",
      privatePayload: corrected,
      expectedVersion: oldSubmit.expectedVersion,
    });
    expect(transport.sent.at(-1)?.commandId).not.toBe(oldSubmit.commandId);
  });
  it("persists the exact envelope before sending and refuses to send without durable storage", async () => {
    const store = createMemoryCaseStore();
    let sends = 0;
    const session = createCaseSession({
      store,
      transport: {
        async sendCommand({ command }) {
          sends++;
          const saved = await store.load();
          expect(saved?.queue[0]).toEqual(command);
          expect(saved?.capabilityToken).toBeDefined();
          return applied(1);
        },
        getStatus: () => Promise.resolve({ status: 404, body: undefined }),
      },
    });
    expect((await session.openDraft()).ok).toBe(true);
    const unavailable = createCaseSession({
      store: {
        ...createMemoryCaseStore(),
        save: () => Promise.reject(new Error("synthetic quota error")),
      },
      transport: {
        sendCommand: () => {
          sends++;
          return Promise.resolve(applied(1));
        },
        getStatus: () => Promise.resolve({ status: 404, body: undefined }),
      },
    });
    expect(await unavailable.openDraft()).toMatchObject({
      ok: false,
      error: { code: "STORAGE_UNAVAILABLE" },
    });
    expect(sends).toBe(1);
  });
  it("queues create, attach, and submit with stable ids and rising versions", async () => {
    const transport = scriptedTransport((command) =>
      applied(
        command.expectedVersion + 1,
        command.type === "submit_draft" ? "received" : "draft",
      ),
    );
    const session = createCaseSession({
      store: createMemoryCaseStore(),
      transport,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
    });

    const opened = await session.openDraft();
    expect(opened.ok).toBe(true);
    const attached = await session.attachFormSnapshot(syntheticFormSnapshot);
    expect(attached.ok).toBe(true);
    const submitted = await session.submit();
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      throw new Error("expected submit to succeed");
    }

    expect(transport.sent.map((command) => command.type)).toEqual([
      "create_draft",
      "attach_private_data",
      "submit_draft",
    ]);
    expect(transport.sent.map((command) => command.expectedVersion)).toEqual([
      0, 1, 2,
    ]);
    expect(
      new Set(transport.sent.map((command) => command.commandId)).size,
    ).toBe(3);
    expect(submitted.value).toMatchObject({
      expectedVersion: 3,
      publicState: "received",
      durability: "received",
      pendingCount: 0,
      mutationAllowed: false,
    });
    expect(JSON.stringify(submitted.value)).not.toContain("domestic_cat");
    expect(JSON.stringify(submitted.value)).not.toContain(
      await session.exportCapabilityToken(),
    );
  });

  it("retries the same command body after a network failure", async () => {
    const attempts: TransportCaseCommand[] = [];
    let failNext = true;
    const transport = scriptedTransport((command) => {
      attempts.push(command);
      if (failNext) {
        failNext = false;
        return "offline";
      }

      return applied(1);
    });
    const session = createCaseSession({
      store: createMemoryCaseStore(),
      transport,
    });

    const opened = await session.openDraft();
    expect(opened.ok).toBe(false);
    if (opened.ok) {
      throw new Error("expected first flush to fail");
    }

    expect(opened.error).toEqual({
      code: "NETWORK_FAILURE",
      retryable: true,
    });

    const snapshot = await session.snapshot();
    expect(snapshot?.durability).toBe("device_only");
    expect(snapshot?.pendingCommandIds).toEqual([attempts[0]?.commandId]);

    const flushed = await session.flush();
    expect(flushed.ok).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
  });

  it("does not bump expectedVersion after a version conflict", async () => {
    const transport = scriptedTransport(() => ({
      status: 409,
      body: { ok: false, error: { code: "VERSION_CONFLICT" } },
    }));
    const session = createCaseSession({
      store: createMemoryCaseStore(),
      transport,
    });

    const opened = await session.openDraft();
    expect(opened).toEqual({
      ok: false,
      error: { code: "VERSION_CONFLICT", retryable: false },
    });

    const snapshot = await session.snapshot();
    expect(snapshot).toMatchObject({
      expectedVersion: 0,
      durability: "needs_attention",
      pendingCount: 1,
    });
    expect(snapshot?.pendingCommandIds[0]).toBe(transport.sent[0]?.commandId);
    expect(transport.sent[0]?.expectedVersion).toBe(0);
  });

  it("rejects deferred snapshots and imported cases as read-only", async () => {
    const transport = scriptedTransport(() => applied(1));
    const session = createCaseSession({
      store: createMemoryCaseStore(),
      transport,
    });

    const opened = await session.openDraft();
    expect(opened.ok).toBe(true);
    const rejected = await session.attachFormSnapshot({
      ...syntheticFormSnapshot,
      situationType: "cruelty",
    } as unknown as FormSnapshotV1);
    expect(rejected).toEqual({
      ok: false,
      error: { code: "INVALID_COMMAND", retryable: false },
    });

    await session.removeLocal();
    const imported = await session.importFromFragment(
      `#c=${encodeCapability(createCapability())}`,
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      throw new Error("expected import to succeed");
    }

    expect(imported.value.mutationAllowed).toBe(false);
    expect(imported.value.publicState).toBe("received");
    expect(
      await session.attachLocation({
        schemaVersion: 1,
        address: "Synthetic testerska 1",
      }),
    ).toEqual({
      ok: false,
      error: { code: "CASE_READ_ONLY", retryable: false },
    });
  });
});
