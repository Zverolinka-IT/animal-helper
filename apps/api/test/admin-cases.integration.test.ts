import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";

import {
  syntheticFormSnapshot,
  syntheticContactPayload,
  syntheticLocationPayload,
  type AdminCaseRequest,
  type FormSnapshotV1,
} from "@animal-helper/contracts";
import {
  applyCheckoutLocalEnvironment,
  applyMigrations,
  createSqlOptions,
  defaultMigrationsDirectory,
  ensureIntegrationDatabase,
  getPublicStatus,
  loadRecordedEvents,
  resolveIntegrationDatabaseUrl,
} from "@animal-helper/event-store";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminCaseDetail,
  adminCaseList,
  adminCommandFromBody,
  adminUpdateCase,
} from "../src/admin/cases.js";
import { createPostgresGateway } from "../src/gateway.js";
import { createApiHandler } from "../src/handler.js";

applyCheckoutLocalEnvironment(
  path.resolve(import.meta.dirname, "../../.."),
  process.env,
);
const databaseUrl = resolveIntegrationDatabaseUrl(process.env);
const email = "synthetic-admin@example.invalid";

describe.skipIf(databaseUrl === undefined)("admin case transactions", () => {
  let sql: Sql;
  let disconnect: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    const url = await ensureIntegrationDatabase(process.env);
    if (url === undefined) throw new Error("test database required");
    sql = postgres(url, createSqlOptions(process.env, { max: 8 }));
    disconnect = () => sql.end();
    await applyMigrations(sql, defaultMigrationsDirectory);
  });
  afterAll(async () => {
    await disconnect?.();
  });

  const createCase = async (form: FormSnapshotV1 = syntheticFormSnapshot) => {
    const streamId = randomUUID();
    const handle = createApiHandler({
      gateway: createPostgresGateway(sql),
      pepper: randomBytes(32),
    });
    const authorization = `Capability ${randomBytes(32).toString("base64url")}`;
    const send = (
      type: "create_draft" | "submit_draft",
      expectedVersion: number,
    ) =>
      handle({
        method: "POST",
        pathname: "/commands",
        search: "",
        origin: undefined,
        authorization,
        body: {
          schemaVersion: 1,
          type,
          streamId,
          expectedVersion,
          commandId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: new Date().toISOString(),
        },
      });
    expect((await send("create_draft", 0)).status).toBe(200);
    for (const [offset, record] of [
      { kind: "location", privatePayload: syntheticLocationPayload },
      { kind: "form_snapshot", privatePayload: form },
      { kind: "contact", privatePayload: syntheticContactPayload },
    ].entries()) {
      const result = await handle({
        method: "POST",
        pathname: "/commands",
        search: "",
        origin: undefined,
        authorization,
        body: {
          schemaVersion: 1,
          type: "attach_private_data",
          streamId,
          expectedVersion: 1 + offset,
          commandId: randomUUID(),
          correlationId: randomUUID(),
          occurredAt: new Date().toISOString(),
          privateRecordId: randomUUID(),
          ...record,
        },
      });
      expect(result.status).toBe(200);
    }
    expect((await send("submit_draft", 4)).status).toBe(200);
    return streamId;
  };

  const request = (
    command: AdminCaseRequest["command"],
    expectedRevision: number,
  ): AdminCaseRequest => ({
    schemaVersion: 1,
    commandId: randomUUID(),
    expectedRevision,
    command,
  });
  const update = (streamId: string, wire: AdminCaseRequest) => {
    const now = new Date();
    const command = adminCommandFromBody(wire.command, email, now, () =>
      randomUUID(),
    );
    if (command === undefined) throw new Error("invalid test command");
    return adminUpdateCase(sql, streamId, email, command, now, wire);
  };

  it("carries optional stray answers and reported outcomes from encrypted records to admin only", async () => {
    const outcome = {
      status: "unresolved" as const,
      reasons: ["other" as const],
      otherText: "Synthetic private reason",
    };
    const condition = {
      symptoms: [],
      behaviour: ["confused" as const],
      collar: "no" as const,
      isJuvenile: "yes" as const,
    };
    const id = await createCase({
      ...syntheticFormSnapshot,
      situationType: "stray",
      condition,
      outcome,
    });
    expect((await adminCaseDetail(sql, id, email))?.facts).toMatchObject({
      condition,
      outcome,
    });
    const events = JSON.stringify(await loadRecordedEvents(sql, id));
    expect(events).not.toContain("Synthetic private reason");
    expect(events).not.toContain("confused");
    expect(JSON.stringify(await getPublicStatus(sql, id))).not.toContain(
      "Synthetic private reason",
    );
  });

  it.each<FormSnapshotV1>([
    {
      ...syntheticFormSnapshot,
      situationType: "dead",
      condition: { symptoms: [] },
      dead: { suspiciousSigns: ["bait"], animalCount: "multiple" },
    },
    {
      ...syntheticFormSnapshot,
      situationType: "cruelty",
      condition: { symptoms: [] },
      cruelty: {
        acute: true,
        signs: ["burned"],
        description: "Synthetic private circumstances",
        police: { outcome: "not-reported", reasons: ["refused"] },
      },
    },
    {
      ...syntheticFormSnapshot,
      situationType: "other",
      condition: { symptoms: [] },
      other: {
        branch: "road",
        situation: "railway",
        serviceReport: { reasons: ["unanswered"] },
        animalHelpRequested: true,
      },
    },
    {
      ...syntheticFormSnapshot,
      situationType: "other",
      condition: { symptoms: [] },
      other: { branch: "human", situation: "trapped" },
    },
    {
      ...syntheticFormSnapshot,
      situationType: "other",
      condition: { symptoms: [] },
      other: {
        branch: "other",
        description: "Synthetic private circumstances",
      },
    },
  ])(
    "submits and manages new flow details without exposing them in events or public status: $situationType",
    async (form) => {
      const id = await createCase(form);
      const detail = await adminCaseDetail(sql, id, email);
      expect(detail?.facts.report).toMatchObject({
        species: form.species,
        ...(form.dead ? { dead: form.dead } : {}),
        ...(form.cruelty ? { cruelty: form.cruelty } : {}),
        ...(form.other ? { other: form.other } : {}),
      });
      const events = JSON.stringify(await loadRecordedEvents(sql, id));
      expect(events).not.toContain("Synthetic private circumstances");
      expect(events).not.toContain("suspiciousSigns");
      expect(events).not.toContain("serviceReport");
      expect(JSON.stringify(await getPublicStatus(sql, id))).not.toContain(
        "Synthetic private circumstances",
      );
      if (detail?.mode === "passive")
        expect(
          await update(id, request({ type: "take_over" }, 0)),
        ).toMatchObject({ ok: true });
      const current = await adminCaseDetail(sql, id, email);
      if (!current) throw new Error("submitted case missing");
      expect(
        await update(id, request({ type: "close" }, current.revision)),
      ).toMatchObject({ ok: true });
      expect(await getPublicStatus(sql, id)).toMatchObject({
        publicState: "closed",
      });
    },
  );

  it("moves the authoritative lifecycle and public status with the workspace", async () => {
    const id = await createCase();
    const taken = await update(id, request({ type: "take_over" }, 0));
    expect(taken).toMatchObject({
      ok: true,
      case: { revision: 1, mode: "active", workflowState: "in_review" },
    });
    const closed = await update(id, request({ type: "close" }, 1));
    expect(closed).toMatchObject({
      ok: true,
      case: { revision: 2, mode: "closed", workflowState: "completed" },
    });
    expect(await getPublicStatus(sql, id)).toMatchObject({
      publicState: "closed",
    });
    expect(
      (await loadRecordedEvents(sql, id)).map((event) => event.type),
    ).toEqual([
      "case.draft_created",
      "case.private_data_attached",
      "case.private_data_attached",
      "case.private_data_attached",
      "case.draft_submitted",
      "case.review_started",
      "case.case_completed",
    ]);
  });

  it("rejects stale concurrent writes and keeps every acknowledged action", async () => {
    const id = await createCase();
    await update(id, request({ type: "take_over" }, 0));
    const attempts = Array.from({ length: 8 }, (_, i) =>
      request(
        { type: "add_action", kind: "call", result: `Synthetic call ${i}` },
        1,
      ),
    );
    const results = await Promise.all(attempts.map((wire) => update(id, wire)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.code === "conflict"),
    ).toHaveLength(7);
    expect((await adminCaseDetail(sql, id, email))?.work.actions).toHaveLength(
      1,
    );
  });

  it("replays an accepted command without duplicating work or events", async () => {
    const id = await createCase();
    await update(id, request({ type: "take_over" }, 0));
    const wire = request(
      { type: "add_action", kind: "call", result: "Synthetic completed call" },
      1,
    );
    expect((await update(id, wire)).ok).toBe(true);
    expect((await update(id, wire)).ok).toBe(true);
    expect((await adminCaseDetail(sql, id, email))?.work.actions).toHaveLength(
      1,
    );
    const close = request({ type: "close" }, 2);
    expect((await update(id, close)).ok).toBe(true);
    expect((await update(id, close)).ok).toBe(true);
    expect(
      (await loadRecordedEvents(sql, id)).filter(
        (event) => event.type === "case.case_completed",
      ),
    ).toHaveLength(1);
  });

  it("marks concurrent reads without overwriting notes or changing edit revisions", async () => {
    const id = await createCase();
    await update(id, request({ type: "take_over" }, 0));
    const reads = Array.from({ length: 6 }, () =>
      adminUpdateCase(
        sql,
        id,
        email,
        { type: "seen", at: new Date().toISOString(), email },
        new Date(),
      ),
    );
    await Promise.all([
      ...reads,
      update(
        id,
        request(
          {
            type: "set_work",
            urgency: "high",
            nextStep: "",
            deadline: "",
            note: "Synthetic follow-up note",
          },
          1,
        ),
      ),
    ]);
    expect(await adminCaseDetail(sql, id, email)).toMatchObject({
      revision: 2,
      work: { note: "Synthetic follow-up note" },
    });
  });

  it("finds an older case directly and exposes another queue page", async () => {
    const id = await createCase();
    const prefix = randomUUID();
    await sql`insert into ah.streams (stream_id) select md5(${prefix} || n::text)::uuid from generate_series(1, 101) n`;
    await sql`insert into ah.case_queue_projection (stream_id, workflow_state, created_at, updated_at)
      select md5(${prefix} || n::text)::uuid, 'submitted', now() + interval '1 minute', now() + interval '1 minute' from generate_series(1, 101) n`;
    expect((await adminCaseList(sql, email)).nextPage).toBe(1);
    expect((await adminCaseDetail(sql, id, email))?.streamId).toBe(id);
    expect((await adminCaseList(sql, email, 1)).cases.length).toBeGreaterThan(
      0,
    );
  });
});
