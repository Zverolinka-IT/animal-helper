import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import {
  syntheticContactDirectoryEntry,
  type GuidanceContactOption,
} from "@animal-helper/contracts";
import {
  applyCheckoutLocalEnvironment,
  applyMigrations,
  bootstrapOperator,
  createSqlOptions,
  defaultMigrationsDirectory,
  deleteOperatorAccount,
  ensureIntegrationDatabase,
  replaceDatabaseName,
  resolveIntegrationDatabaseUrl,
} from "@animal-helper/event-store";
import {
  parsePublicGuidance,
  isContactOptionInstruction,
} from "@animal-helper/guidance";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAdminConfig } from "../src/admin/config.js";
import { createApiHandler, type ApiRequest } from "../src/handler.js";
import { createMemoryGateway } from "../src/memory-gateway.js";
import { softwarePasskey } from "./software-passkey.js";

type GuidanceKindResponse = {
  contentHash: string;
  contactOptions: GuidanceContactOption[];
};

applyCheckoutLocalEnvironment(
  path.resolve(import.meta.dirname, "../../.."),
  process.env,
);
const base = resolveIntegrationDatabaseUrl(process.env);
// Publication tests own this loopback-only database; other integration suites
// snapshot/restore the guidance tables and must not race these publishers.
const env = {
  ...process.env,
  DATABASE_TEST_URL: base
    ? replaceDatabaseName(
        base,
        "animal_helper_guidance_options_test",
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
const now = new Date("2026-10-22T10:00:00Z");
const cookies = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => value.split(";")[0]).join("; ");

describe.skipIf(!base)("dynamic guidance contact options", () => {
  let sql: Sql;
  let handle: ReturnType<typeof createApiHandler>;
  let cookie: string;
  const email = `contacts-${randomUUID()}@example.invalid`;
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
      gateway: createMemoryGateway(),
      pepper: randomBytes(32),
      admin: { sql, config },
      now: () => now,
    });
    const token = await bootstrapOperator(sql, email, now);
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
    await sql`delete from ah.guidance_publications`;
    await sql`delete from ah.guidance_revisions`;
    await sql`delete from ah.contact_directory_commands`;
    await sql`delete from ah.contact_directory_revisions`;
    await sql`update ah.contact_directory_draft set revision = 0, document = '{"schemaVersion":1,"jurisdiction":"SK","entries":[]}'::jsonb`;
  });
  afterAll(async () => {
    await deleteOperatorAccount(sql, email);
    await sql.end();
  });

  const read = async () =>
    (
      await request({
        method: "GET",
        pathname: "/admin/guidance/kind/injured/domestic_cat",
      })
    ).body as GuidanceKindResponse;
  const saveOptions = (
    expectedHash: string,
    options: readonly GuidanceContactOption[],
  ) =>
    request({
      method: "POST",
      pathname: "/admin/guidance/contacts",
      body: { expectedHash, kindKey: "domestic_cat", options },
    });
  const option = (
    id: string,
    serviceKey: GuidanceContactOption["serviceKey"] = "vet_clinic",
  ): GuidanceContactOption => ({
    id,
    serviceKey,
    title: `Možnosť ${id}`,
    body: `Pokyny ${id}`,
    enabled: true,
  });
  const publish = (expectedHash: string) =>
    request({
      method: "POST",
      pathname: "/admin/guidance/publish",
      body: { expectedHash, description: "Synthetic ordered options" },
    });

  it("preserves legacy options, saves an arbitrary ordered list, and publishes an immutable snapshot", async () => {
    const before = await read();
    expect(
      before.contactOptions
        .filter((item) => item.enabled)
        .map((item) => item.serviceKey),
    ).toEqual(["municipality_capture", "vet_clinic", "volunteers"]);
    const configured = [
      option("third", "volunteers"),
      option("first"),
      {
        ...option("second", "vet_exotic"),
        clinicVariant: "protected" as const,
      },
      option("fourth", "police"),
    ];
    const saved = await saveOptions(before.contentHash, configured);
    expect(saved.status).toBe(200);
    const draft = saved.body as GuidanceKindResponse;
    expect(draft.contactOptions).toEqual(configured);
    expect((await read()).contactOptions).toEqual(configured);
    expect(
      (await request({ method: "GET", pathname: "/guidance" })).body,
    ).toMatchObject({ source: "bundled" });
    expect((await publish(draft.contentHash)).status).toBe(200);
    const published = parsePublicGuidance(
      (await request({ method: "GET", pathname: "/guidance" })).body,
    );
    expect(
      published.kinds.domestic_cat?.items
        .filter((item) => isContactOptionInstruction(item.instructionKey))
        .map((item) => item.action?.targetKey),
    ).toEqual(configured.map((item) => item.serviceKey));
    expect(
      published.kinds.domestic_cat?.items.find(
        (item) => item.instructionKey === "contact.option.second",
      ),
    ).toMatchObject({ clinicVariant: "protected" });
    expect(
      (
        await saveOptions(draft.contentHash, [
          configured[1] as GuidanceContactOption,
        ])
      ).status,
    ).toBe(200);
    expect(
      parsePublicGuidance(
        (await request({ method: "GET", pathname: "/guidance" })).body,
      ),
    ).toEqual(published);
    const directoryEntry = syntheticContactDirectoryEntry({
      serviceKeys: ["volunteers"],
      coverage: { kind: "national" },
    });
    const directorySave = await request({
      method: "POST",
      pathname: "/admin/contact-directory",
      body: {
        schemaVersion: 1,
        commandId: randomUUID(),
        expectedRevision: 0,
        command: { type: "save_entry", entry: directoryEntry },
      },
    });
    expect(directorySave.status).toBe(200);
    const directoryPublish = await request({
      method: "POST",
      pathname: "/admin/contact-directory",
      body: {
        schemaVersion: 1,
        commandId: randomUUID(),
        expectedRevision: 1,
        command: { type: "publish" },
      },
    });
    expect(directoryPublish.status).toBe(200);
    const withDirectory = parsePublicGuidance(
      (await request({ method: "GET", pathname: "/guidance" })).body,
    );
    expect(withDirectory.kinds.domestic_cat?.items).toEqual(
      published.kinds.domestic_cat?.items,
    );
    expect(withDirectory.contactDirectory?.entries[0]?.id).toBe(
      directoryEntry.id,
    );
    expect((await publish((await read()).contentHash)).status).toBe(200);
    const republished = parsePublicGuidance(
      (await request({ method: "GET", pathname: "/guidance" })).body,
    );
    expect(republished.contactDirectory).toEqual(
      withDirectory.contactDirectory,
    );
    expect(
      republished.kinds.domestic_cat?.items.filter((item) =>
        isContactOptionInstruction(item.instructionKey),
      ),
    ).toHaveLength(1);
    const audit =
      await sql`select * from ah.audit_events where action = 'guidance_contacts_saved'`;
    expect(audit.length).toBeGreaterThan(0);
  }, 15_000);

  it("publishes report profiles atomically, keeps them private until publication and preserves them through directory and legacy edits", async () => {
    const profile = {
      context: "dead-suspicious",
      kindKey: "domestic_cat",
      warning: "Synthetic warning",
      instructions: "Synthetic instruction",
      contacts: [option("police", "police")],
    };
    const route = "/admin/guidance/report-flows";
    const before = await read();
    const body = { expectedHash: before.contentHash, profile };
    expect(
      (await request({ method: "GET", pathname: route, cookie: "" })).status,
    ).toBe(401);
    expect(
      (
        await request({
          method: "POST",
          pathname: route,
          origin: "https://example.invalid",
          body,
        })
      ).status,
    ).toBe(403);
    const attempts = await Promise.all([
      request({ method: "POST", pathname: route, body }),
      request({
        method: "POST",
        pathname: route,
        body: { ...body, profile: { ...profile, warning: "Concurrent edit" } },
      }),
    ]);
    expect(attempts.map((result) => result.status).sort()).toEqual([200, 409]);
    const accepted = attempts.find((result) => result.status === 200);
    if (!accepted) throw new Error("no accepted profile edit");
    const draft = accepted.body as {
      contentHash: string;
      profiles: unknown[];
    };
    expect(
      (await request({ method: "GET", pathname: "/guidance" })).body,
    ).not.toHaveProperty("reportProfiles");
    const optionsSaved = await saveOptions(draft.contentHash, [
      option("legacy-contact"),
    ]);
    expect(optionsSaved.status).toBe(200);
    expect(
      (await publish((optionsSaved.body as GuidanceKindResponse).contentHash))
        .status,
    ).toBe(200);
    const published = parsePublicGuidance(
      (await request({ method: "GET", pathname: "/guidance" })).body,
    );
    expect(published.reportProfiles).toEqual(draft.profiles);
    const directory = await request({
      method: "POST",
      pathname: "/admin/contact-directory",
      body: {
        schemaVersion: 1,
        commandId: randomUUID(),
        expectedRevision: 0,
        command: {
          type: "save_entry",
          entry: syntheticContactDirectoryEntry({
            serviceKeys: ["police"],
            coverage: { kind: "national" },
          }),
        },
      },
    });
    expect(directory.status).toBe(200);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/contact-directory",
          body: {
            schemaVersion: 1,
            commandId: randomUUID(),
            expectedRevision: 1,
            command: { type: "publish" },
          },
        })
      ).status,
    ).toBe(200);
    expect(
      parsePublicGuidance(
        (await request({ method: "GET", pathname: "/guidance" })).body,
      ).reportProfiles,
    ).toEqual(draft.profiles);
    const current = await read();
    for (const invalid of [
      { ...profile, kindKey: "invented" },
      { ...profile, warning: "https://example.invalid" },
      { ...profile, contacts: [option("same"), option("same")] },
      { ...profile, context: "cruelty" },
      {
        ...profile,
        kindKey: undefined,
        contacts: [{ ...option("protected"), clinicVariant: "protected" }],
      },
    ]) {
      expect(
        (
          await request({
            method: "POST",
            pathname: route,
            body: { expectedHash: current.contentHash, profile: invalid },
          })
        ).status,
      ).toBe(400);
    }
    const incomplete = await request({
      method: "POST",
      pathname: route,
      body: {
        expectedHash: current.contentHash,
        profile: {
          ...profile,
          contacts: [{ ...option("unfinished"), body: "" }],
        },
      },
    });
    expect(incomplete.status).toBe(200);
    expect(
      (await publish((incomplete.body as { contentHash: string }).contentHash))
        .status,
    ).toBe(400);
    expect(
      parsePublicGuidance(
        (await request({ method: "GET", pathname: "/guidance" })).body,
      ).reportProfiles,
    ).toEqual(draft.profiles);
  }, 15_000);

  it("allows only one concurrent replacement at the same revision without leaving a partial list", async () => {
    const before = await read();
    const left = [option("left-one"), option("left-two")];
    const right = [
      option("right-one", "volunteers"),
      option("right-two"),
      option("right-three"),
    ];
    const responses = await Promise.all([
      saveOptions(before.contentHash, left),
      saveOptions(before.contentHash, right),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const winner = responses[0].status === 200 ? left : right;
    expect((await read()).contactOptions).toEqual(winner);
    expect(
      (await saveOptions(before.contentHash, [option("obsolete")])).status,
    ).toBe(409);
  });

  it("validates IDs, services and safe copy, keeps drafts private, and requires a trusted admin session", async () => {
    const before = await read();
    const body = {
      expectedHash: before.contentHash,
      kindKey: "domestic_cat",
      options: [option("one")],
    };
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/guidance/contacts",
          cookie: "",
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/guidance/contacts",
          origin: "https://example.invalid",
          body,
        })
      ).status,
    ).toBe(403);
    for (const options of [
      [],
      [option("duplicate"), option("duplicate")],
      [{ ...option("one"), serviceKey: "invented" }],
      [{ ...option("one", "police"), clinicVariant: "protected" }],
      [{ ...option("one"), body: "https://example.invalid" }],
      [{ ...option("one"), enabled: false }],
    ]) {
      expect(
        (
          await request({
            method: "POST",
            pathname: "/admin/guidance/contacts",
            body: { ...body, options },
          })
        ).status,
      ).toBe(400);
    }
    expect((await read()).contactOptions).toEqual(before.contactOptions);
    const incomplete = await saveOptions(before.contentHash, [
      { ...option("unfinished"), body: "" },
    ]);
    expect(incomplete.status).toBe(200);
    expect(
      (await publish((incomplete.body as GuidanceKindResponse).contentHash))
        .status,
    ).toBe(400);
    expect(
      (await request({ method: "GET", pathname: "/guidance" })).body,
    ).toMatchObject({ source: "bundled" });
  });
});
