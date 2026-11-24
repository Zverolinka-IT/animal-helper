import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import {
  createCaseSession,
  createMemoryCaseStore,
} from "@animal-helper/client";
import {
  syntheticContactPayload,
  syntheticFormSnapshot,
  syntheticLocationPayload,
  type ContactPayloadV1,
  type AdminCaseSearch,
} from "@animal-helper/contracts";
import {
  applyCheckoutLocalEnvironment,
  applyCommand,
  applyMigrations,
  bootstrapOperator,
  createSqlOptions,
  defaultMigrationsDirectory,
  deleteOperatorAccount,
  ensureIntegrationDatabase,
  hashCommandContent,
  replaceDatabaseName,
  resolveIntegrationDatabaseUrl,
} from "@animal-helper/event-store";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminCaseDetail,
  adminCaseList,
  adminUpdateCase,
} from "../src/admin/cases.js";
import { loadAdminConfig } from "../src/admin/config.js";
import { createPostgresGateway } from "../src/gateway.js";
import { createApiHandler, type ApiRequest } from "../src/handler.js";
import { softwarePasskey } from "./software-passkey.js";

applyCheckoutLocalEnvironment(
  path.resolve(import.meta.dirname, "../../.."),
  process.env,
);
const base = resolveIntegrationDatabaseUrl(process.env);
const env = {
  ...process.env,
  DATABASE_TEST_URL: base
    ? replaceDatabaseName(
        base,
        "animal_helper_case_search_test",
        "DATABASE_TEST_URL",
      )
    : undefined,
};
const origin = "http://localhost:5174";
const config = loadAdminConfig({
  DATABASE_ENVIRONMENT: "local",
  ADMIN_ORIGIN: origin,
});
if (!config) throw new Error("admin config required");
const now = new Date("2026-10-22T12:00:00Z");
const operatorEmail = `search-${randomUUID()}@example.invalid`;
const cookies = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => value.split(";")[0]).join("; ");

describe.skipIf(!base)("admin fuzzy search", () => {
  let sql: Sql;
  let handle: ReturnType<typeof createApiHandler>;
  let cookie: string;
  const request = (
    partial: Partial<ApiRequest> & Pick<ApiRequest, "method" | "pathname">,
  ) =>
    handle({
      search: "",
      authorization: undefined,
      body: undefined,
      origin,
      host: "localhost:5174",
      cookie,
      ...partial,
    });

  beforeAll(async () => {
    const url = await ensureIntegrationDatabase(env);
    if (!url) throw new Error("loopback test database required");
    sql = postgres(url, createSqlOptions(env, { max: 4 }));
    await applyMigrations(sql, defaultMigrationsDirectory);
    handle = createApiHandler({
      gateway: createPostgresGateway(sql),
      pepper: randomBytes(32),
      admin: { sql, config },
      now: () => now,
    });
    const token = await bootstrapOperator(sql, operatorEmail, now);
    const key = softwarePasskey();
    const options = await request({
      method: "POST",
      pathname: "/admin/auth/register/options",
      cookie: "",
      body: { bootstrapToken: token },
    });
    const registered = await request({
      method: "POST",
      pathname: "/admin/auth/register/verify",
      cookie: cookies(options.cookies),
      body: {
        response: key.register(
          (options.body as { options: Parameters<typeof key.register>[0] })
            .options,
          origin,
        ),
      },
    });
    expect(registered.status).toBe(200);
    cookie = cookies(registered.cookies);
  });
  beforeEach(async () => {
    await sql`truncate ah.streams cascade`;
  });
  afterAll(async () => {
    await deleteOperatorAccount(sql, operatorEmail);
    await sql.end();
  });

  const createCase = async (
    contact: ContactPayloadV1,
    previousContact?: ContactPayloadV1,
    address: string = syntheticLocationPayload.address,
  ) => {
    const session = createCaseSession({
      store: createMemoryCaseStore(),
      now: () => now,
      transport: {
        sendCommand: ({ command, authorization }) =>
          request({
            method: "POST",
            pathname: "/commands",
            authorization,
            body: command,
          }),
        getStatus: ({ authorization }) =>
          request({ method: "GET", pathname: "/status", authorization }),
      },
    });
    expect((await session.openDraft()).ok).toBe(true);
    expect(
      (await session.attachLocation({ ...syntheticLocationPayload, address }))
        .ok,
    ).toBe(true);
    expect((await session.attachFormSnapshot(syntheticFormSnapshot)).ok).toBe(
      true,
    );
    if (previousContact)
      expect((await session.attachContact(previousContact)).ok).toBe(true);
    const submitted = await session.submit(contact);
    if (!submitted.ok) throw new Error("synthetic submission failed");
    return submitted.value.streamId;
  };
  const search = (
    filters: Partial<
      Pick<AdminCaseSearch, "query" | "reporterEmail" | "ownerEmail">
    >,
    page = 0,
  ) =>
    adminCaseList(sql, operatorEmail, page, {
      query: "",
      reporterEmail: "",
      ownerEmail: "",
      ...filters,
    });

  const contact = (email: string): ContactPayloadV1 => ({
    ...syntheticContactPayload,
    email,
  });

  const assign = async (streamId: string) => {
    const result = await adminUpdateCase(
      sql,
      streamId,
      operatorEmail,
      { type: "take_over", email: operatorEmail, at: now.toISOString() },
      now,
      {
        schemaVersion: 1,
        commandId: randomUUID(),
        expectedRevision: 0,
        command: { type: "take_over" },
      },
    );
    expect(result).toMatchObject({ ok: true });
  };

  it("uses the same partial, accent-insensitive and typo-tolerant matching for general text and both emails", async () => {
    const id = await createCase(
      contact("jan.herich@example.invalid"),
      undefined,
      "Žilina, Hlavná 1",
    );
    await assign(id);
    await createCase(contact("unrelated@example.invalid"), undefined, "Košice");
    const ownerTypo = operatorEmail.replace("search-", "saerch-");
    for (const filters of [
      { reporterEmail: "HERCIH" },
      { ownerEmail: ownerTypo },
      { query: "hercih" },
      { query: ownerTypo },
      { query: "macka zilnia" },
      { query: "zilnia zrannee" },
      { query: "ZILINA", reporterEmail: "hercih", ownerEmail: ownerTypo },
    ]) {
      expect(
        (await search(filters)).cases.map((item) => item.streamId),
      ).toEqual([id]);
    }
    expect(
      (await search({ reporterEmail: "unrelated", ownerEmail: ownerTypo }))
        .cases,
    ).toEqual([]);
    expect(
      (
        await search({
          query: "completely-absent-location",
          reporterEmail: "hercih",
        })
      ).cases,
    ).toEqual([]);
  });

  it("matches full or partial email without case sensitivity and returns it in queue summaries", async () => {
    const id = await createCase(contact("Reporter@example.invalid"));
    await createCase(contact("another@example.invalid"));
    const full = await search(
      { reporterEmail: "  REPORTER@EXAMPLE.INVALID  " },
      0,
    );
    expect(full.cases.map((item) => item.streamId)).toEqual([id]);
    expect(full.cases[0]?.reporterEmail).toBe("Reporter@example.invalid");
    const partial = await search({ reporterEmail: "  rEpOrTeR@  " }, 0);
    expect(partial.cases.map((item) => item.streamId)).toEqual([id]);
    expect(partial.nextPage).toBeNull();
    expect((await search({ reporterEmail: "  " }, 0)).cases).toHaveLength(2);
  });

  it("uses only the latest retained contact and excludes absent or removed email", async () => {
    const corrected = await createCase(
      contact("corrected@example.invalid"),
      contact("old@example.invalid"),
    );
    await sql`update ah.private_records set created_at = ${now}
      where stream_id = ${corrected}::uuid and kind = 'contact'`;
    await createCase(
      { schemaVersion: 1, shareWithAuthorities: false, newsletter: false },
      contact("removed@example.invalid"),
    );
    await createCase({
      schemaVersion: 1,
      shareWithAuthorities: false,
      newsletter: false,
    });
    expect((await search({ reporterEmail: "old@" }, 0)).cases).toEqual([]);
    expect((await search({ reporterEmail: "removed@" }, 0)).cases).toEqual([]);
    expect(
      (await search({ reporterEmail: "@example.invalid" }, 0)).cases.map(
        (item) => item.streamId,
      ),
    ).toEqual([corrected]);
  });

  it("treats SQL wildcard and injection characters as literal search text", async () => {
    const id = await createCase(contact("first_last@example.invalid"));
    await createCase(contact("firstXlast@example.invalid"));
    expect(
      (await search({ reporterEmail: "_" }, 0)).cases.map(
        (item) => item.streamId,
      ),
    ).toEqual([id]);
    expect((await search({ reporterEmail: "%" }, 0)).cases).toEqual([]);
    expect((await search({ reporterEmail: "' OR true --" }, 0)).cases).toEqual(
      [],
    );
  });

  it("filters before pagination, including cases beyond the unfiltered first page", async () => {
    const id = await createCase(contact("older@example.invalid"));
    const prefix = randomUUID();
    await assign(id);
    await sql`insert into ah.streams (stream_id) select md5(${prefix} || n::text)::uuid from generate_series(1, 301) n`;
    await sql`insert into ah.case_queue_projection (stream_id, workflow_state, created_at, updated_at)
      select md5(${prefix} || n::text)::uuid, 'submitted', ${now}::timestamptz + interval '1 day', ${now}::timestamptz + interval '1 day' from generate_series(1, 301) n`;
    await sql`insert into ah.private_records (private_record_id, stream_id, kind, payload)
      select md5(${prefix} || 'contact' || n::text)::uuid, md5(${prefix} || n::text)::uuid, 'contact',
        jsonb_build_object('schemaVersion', 1, 'email', 'batch@example.invalid', 'shareWithAuthorities', false, 'newsletter', false)
      from generate_series(1, 301) n`;
    expect(
      (await adminCaseList(sql, operatorEmail)).cases.some(
        (item) => item.streamId === id,
      ),
    ).toBe(false);
    expect(
      (await search({ reporterEmail: "older@" }, 0)).cases.map(
        (item) => item.streamId,
      ),
    ).toEqual([id]);
    expect(
      (await search({ query: "odler" })).cases.map((item) => item.streamId),
    ).toEqual([id]);
    expect(
      (
        await search({
          ownerEmail: operatorEmail.replace("search-", "saerch-"),
        })
      ).cases.map((item) => item.streamId),
    ).toEqual([id]);
    const first = await search({ reporterEmail: "batch@" }, 0);
    const second = await search({ reporterEmail: "batch@" }, 1);
    const third = await search({ reporterEmail: "batch@" }, 2);
    const last = await search({ reporterEmail: "batch@" }, 3);
    expect(first.cases).toHaveLength(100);
    expect(first.nextPage).toBe(1);
    expect(last.cases).toHaveLength(1);
    expect(last.nextPage).toBeNull();
    expect(
      new Set(
        [...first.cases, ...second.cases, ...third.cases, ...last.cases].map(
          (item) => item.streamId,
        ),
      ).size,
    ).toBe(301);
  });

  it("stops matching email after private data is purged", async () => {
    const streamId = await createCase(contact("erasable@example.invalid"));
    expect(
      (await search({ reporterEmail: "erasable@" }, 0)).cases,
    ).toHaveLength(1);
    const taken = await adminUpdateCase(
      sql,
      streamId,
      operatorEmail,
      { type: "take_over", email: operatorEmail, at: now.toISOString() },
      now,
      {
        schemaVersion: 1,
        commandId: randomUUID(),
        expectedRevision: 0,
        command: { type: "take_over" },
      },
    );
    expect(taken).toMatchObject({ ok: true, case: { revision: 1 } });
    const closed = await adminUpdateCase(
      sql,
      streamId,
      operatorEmail,
      { type: "close" },
      now,
      {
        schemaVersion: 1,
        commandId: randomUUID(),
        expectedRevision: 1,
        command: { type: "close" },
      },
    );
    expect(closed).toMatchObject({ ok: true, case: { revision: 2 } });
    const commandId = randomUUID();
    const purged = await applyCommand(sql, {
      streamId,
      commandId,
      expectedVersion: 7,
      correlationId: randomUUID(),
      occurredAt: now.toISOString(),
      actorKind: "administrator",
      domainCommand: { type: "purge_private_data" },
      contentHash: hashCommandContent({
        commandId,
        streamId,
        type: "purge_private_data",
      }),
      now,
    });
    expect(purged).toMatchObject({ ok: true });
    expect((await search({ reporterEmail: "erasable@" }, 0)).cases).toEqual([]);
    expect((await search({ query: "erasalbe" })).cases).toEqual([]);
    expect(
      (await adminCaseDetail(sql, streamId, operatorEmail))?.reporterEmail,
    ).toBe("");
  });

  it("requires an admin session and trusted origin, validates the body, and does not audit the searched email", async () => {
    const streamId = await createCase(
      contact("private-reporter@example.invalid"),
    );
    await assign(streamId);
    const body = {
      schemaVersion: 1,
      query: "private-reproter",
      reporterEmail: "private-reporter@",
      ownerEmail: "saerch",
    };
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/cases/search",
          cookie: "",
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/cases/search",
          origin: "https://example.invalid",
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/cases/search",
          body: { ...body, page: -1 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request({
          method: "GET",
          pathname: "/admin/cases",
          search: "?email=private-reporter",
        })
      ).status,
    ).toBe(400);
    const response = await request({
      method: "POST",
      pathname: "/admin/cases/search",
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      cases: [{ streamId, reporterEmail: "private-reporter@example.invalid" }],
      nextPage: null,
    });
    const audit =
      await sql`select * from ah.audit_events where action = 'case_list_read'`;
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain("private-reporter");
    expect(JSON.stringify(audit)).not.toContain("private-reproter");
    expect(JSON.stringify(audit)).not.toContain("saerch");
  });
});
