import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import {
  syntheticContactDirectoryEntry,
  type AdminContactDirectory,
  type ContactDirectoryEntry,
  type ContactDirectoryRequest,
} from "@animal-helper/contracts";
import {
  applyCheckoutLocalEnvironment,
  applyMigrations,
  bootstrapOperator,
  createSqlOptions,
  defaultMigrationsDirectory,
  deleteOperatorAccount,
  ensureIntegrationDatabase,
  loadContactDirectoryRelease,
  replaceDatabaseName,
  resolveIntegrationDatabaseUrl,
} from "@animal-helper/event-store";
import { parsePublicGuidance } from "@animal-helper/guidance";
import { selectContacts } from "@animal-helper/jurisdictions";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadAdminConfig } from "../src/admin/config.js";
import { createApiHandler, type ApiRequest } from "../src/handler.js";
import { createMemoryGateway } from "../src/memory-gateway.js";
import { softwarePasskey } from "./software-passkey.js";
import { serveFetch } from "../src/fetch-handler.js";

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
        "animal_helper_contacts_test",
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
const now = new Date("2026-10-20T10:00:00Z");
const cookies = (values: readonly string[] | undefined) =>
  (values ?? []).map((value) => value.split(";")[0]).join("; ");

describe.skipIf(!base)("administrator-managed public contacts", () => {
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
  const read = async () =>
    (await request({ method: "GET", pathname: "/admin/contact-directory" }))
      .body as AdminContactDirectory;
  const command = async (
    command: ContactDirectoryRequest["command"],
    expectedRevision: number,
    commandId: string = randomUUID(),
  ) =>
    request({
      method: "POST",
      pathname: "/admin/contact-directory",
      body: { schemaVersion: 1, commandId, expectedRevision, command },
    });
  const save = (entry: ContactDirectoryEntry, revision = 0, id?: string) =>
    command({ type: "save_entry", entry }, revision, id);
  const publish = (revision: number, id?: string) =>
    command({ type: "publish" }, revision, id);
  const publicResponse = () =>
    request({ method: "GET", pathname: "/guidance" });
  const importContacts = async (
    entries: ContactDirectoryEntry[],
    expectedRevision: number,
    commandId = randomUUID(),
  ) => {
    const response = await serveFetch(
      handle,
      new Request(`${origin}/admin/contact-directory/import`, {
        method: "POST",
        headers: {
          origin,
          cookie,
          host: "localhost:5174",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          commandId,
          expectedRevision,
          command: { type: "import_entries", entries },
        }),
      }),
    );
    return {
      status: response.status,
      body: await response.json(),
    };
  };

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

  it("requires a current operator and trusted origin for changes", async () => {
    expect(
      (
        await request({
          method: "GET",
          pathname: "/admin/contact-directory",
          cookie: "",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/contact-directory",
          cookie: "",
          body: {},
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/contact-directory",
          origin: "https://example.invalid",
          body: {},
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request({
          method: "GET",
          pathname: "/admin/contact-directory",
          search: "?token=anything",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/contact-directory",
          body: {},
        })
      ).status,
    ).toBe(400);
  });

  it("imports hidden entries atomically, skips exact duplicates, preserves existing records and safely replays a request", async () => {
    const original = syntheticContactDirectoryEntry();
    expect((await save(original)).status).toBe(200);
    const duplicate = { ...original, id: randomUUID(), enabled: false };
    const added = syntheticContactDirectoryEntry({
      id: randomUUID(),
      name: "Synthetic volunteer",
      serviceKeys: ["volunteers"],
      enabled: false,
    });
    const commandId = randomUUID();
    const imported = await importContacts([duplicate, added], 1, commandId);
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({
      revision: 2,
      document: { entries: [original, added] },
    });
    expect(
      (await importContacts([duplicate, added], 1, commandId)).status,
    ).toBe(200);
    expect((await read()).revision).toBe(2);
    expect(
      (
        await importContacts(
          [{ ...added, name: "Changed retry" }],
          1,
          commandId,
        )
      ).status,
    ).toBe(409);
    expect((await importContacts([duplicate, added], 2)).status).toBe(200);
    expect((await read()).document.entries).toEqual([original, added]);
    expect((await publish(3)).status).toBe(200);
    const published = parsePublicGuidance((await publicResponse()).body);
    expect(published.contactDirectory?.entries).toEqual([original]);
  });

  it("publishes imported regular and exotic clinics only after verification, preserving volunteer contacts and customer service routing", async () => {
    const volunteer = syntheticContactDirectoryEntry({
      id: randomUUID(),
      name: "Synthetic volunteer",
      serviceKeys: ["volunteers"],
    });
    expect((await save(volunteer)).status).toBe(200);
    const clinic = syntheticContactDirectoryEntry({
      id: randomUUID(),
      name: "Synthetic regular clinic",
      serviceKeys: ["vet_clinic"],
      enabled: false,
      sourceUrl: "",
      verifiedOn: "",
      reviewDueOn: "",
    });
    const exotic = {
      ...clinic,
      id: randomUUID(),
      name: "Synthetic exotic clinic",
      serviceKeys: ["vet_exotic" as const],
    };
    expect((await importContacts([clinic, exotic], 1)).status).toBe(200);
    expect((await publish(2)).status).toBe(200);
    const hidden = parsePublicGuidance(
      (await publicResponse()).body,
    ).contactDirectory;
    expect(hidden?.entries).toEqual([volunteer]);

    expect((await save({ ...clinic, enabled: true }, 3)).status).toBe(200);
    expect((await publish(4)).status).toBe(400);
    expect(
      parsePublicGuidance((await publicResponse()).body).contactDirectory,
    ).toEqual(hidden);
    const verified = {
      ...clinic,
      enabled: true,
      sourceUrl: "https://example.invalid/clinic",
      verifiedOn: "2026-10-20",
      reviewDueOn: "2099-01-01",
    };
    const verifiedExotic = {
      ...verified,
      id: exotic.id,
      name: exotic.name,
      serviceKeys: exotic.serviceKeys,
    };
    expect((await save(verified, 4)).status).toBe(200);
    expect((await save(verifiedExotic, 5)).status).toBe(200);
    expect((await publish(6)).status).toBe(200);
    const publicDirectory = parsePublicGuidance(
      (await publicResponse()).body,
    ).contactDirectory;
    expect(
      selectContacts(
        publicDirectory,
        "vet_clinic",
        clinic.coordinates,
        now,
      ).map(({ entry }) => entry.id),
    ).toEqual([clinic.id]);
    expect(
      selectContacts(
        publicDirectory,
        "vet_exotic",
        clinic.coordinates,
        now,
      ).map(({ entry }) => entry.id),
    ).toEqual([exotic.id]);
    expect(
      selectContacts(
        publicDirectory,
        "volunteers",
        clinic.coordinates,
        now,
      ).map(({ entry }) => entry.id),
    ).toEqual([volunteer.id]);

    expect((await save({ ...verified, enabled: false }, 7)).status).toBe(200);
    expect((await publish(8)).status).toBe(200);
    const disabled = parsePublicGuidance(
      (await publicResponse()).body,
    ).contactDirectory;
    expect(
      selectContacts(disabled, "vet_clinic", clinic.coordinates, now),
    ).toEqual([]);
    expect(
      selectContacts(disabled, "vet_exotic", clinic.coordinates, now).map(
        ({ entry }) => entry.id,
      ),
    ).toEqual([exotic.id]);
    expect(
      selectContacts(disabled, "volunteers", clinic.coordinates, now).map(
        ({ entry }) => entry.id,
      ),
    ).toEqual([volunteer.id]);
  });

  it("rejects active/invalid imports, reused IDs, untrusted origins and unauthenticated requests", async () => {
    const entry = syntheticContactDirectoryEntry({ enabled: false });
    const body = {
      schemaVersion: 1,
      commandId: randomUUID(),
      expectedRevision: 0,
      command: { type: "import_entries", entries: [entry] },
    };
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/contact-directory/import",
          body,
          cookie: "",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request({
          method: "POST",
          pathname: "/admin/contact-directory/import",
          body,
          origin: "https://example.invalid",
        })
      ).status,
    ).toBe(403);
    expect(
      (await importContacts([{ ...entry, enabled: true }], 0)).status,
    ).toBe(400);
    expect((await importContacts([entry, entry], 0)).status).toBe(400);
    expect(
      (
        await importContacts(
          [entry, { ...entry, id: randomUUID(), phone: "invalid" }],
          0,
        )
      ).status,
    ).toBe(400);
    expect((await read()).document.entries).toEqual([]);
    expect((await importContacts([entry], 0)).status).toBe(200);
    expect(
      (
        await importContacts(
          [{ ...entry, name: "Different contact with same ID" }],
          1,
        )
      ).status,
    ).toBe(400);
    expect((await read()).document.entries).toEqual([entry]);
  });

  it("accepts large batches through the HTTP adapter, enforces directory capacity and detects concurrent edits", async () => {
    const entries = Array.from({ length: 1000 }, (_, index) =>
      syntheticContactDirectoryEntry({
        id: randomUUID(),
        name: `Synthetic contact ${index}`,
        enabled: false,
      }),
    );
    expect(JSON.stringify(entries).length).toBeGreaterThan(65_536);
    expect((await importContacts(entries, 0)).status).toBe(200);
    expect(
      (
        await importContacts(
          [
            syntheticContactDirectoryEntry({
              id: randomUUID(),
              enabled: false,
            }),
          ],
          1,
        )
      ).status,
    ).toBe(400);
    expect((await read()).document.entries).toHaveLength(1000);
    expect((await read()).revision).toBe(1);
    expect(
      (await importContacts([entries[0] as ContactDirectoryEntry], 0)).status,
    ).toBe(409);
    const first = entries[0],
      last = entries.at(-1);
    if (!first || !last) throw new Error("batch missing");
    const race = await Promise.all([
      importContacts([first], 1),
      command({ type: "remove_entry", id: last.id }, 1),
    ]);
    expect(race.map((response) => response.status).sort()).toEqual([200, 409]);
    const after = await read();
    expect(after.revision).toBe(2);
    expect(after.document.entries).toHaveLength(
      race[0].status === 200 ? 1000 : 999,
    );
  });

  it("saves incomplete drafts without exposing them and blocks incomplete publication", async () => {
    const incomplete = syntheticContactDirectoryEntry({
      phone: "",
      website: "",
      sourceUrl: "",
      verifiedOn: "",
      reviewDueOn: "",
    });
    expect((await save(incomplete)).status).toBe(200);
    expect((await read()).document.entries).toEqual([incomplete]);
    expect(
      parsePublicGuidance((await publicResponse()).body).contactDirectory,
    ).toBeUndefined();
    const rejected = await publish(1);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      error: { code: "invalid_content", issues: [{ id: incomplete.id }] },
    });
    expect((await read()).revision).toBe(1);
    expect(
      await sql`select revision_id from ah.contact_directory_revisions`,
    ).toHaveLength(0);
  });

  it("publishes an immutable snapshot, updates ETags, and keeps subsequent draft edits private", async () => {
    const entry = syntheticContactDirectoryEntry();
    expect((await save(entry)).status).toBe(200);
    expect((await publish(1)).status).toBe(200);
    const first = await publicResponse();
    const guidance = parsePublicGuidance(first.body);
    expect(guidance.contactDirectory?.entries).toEqual([entry]);
    expect(first.headers.etag).toBe(`"${guidance.contentHash}"`);
    expect((await read()).hasUnpublishedChanges).toBe(false);
    expect(
      (
        await request({
          method: "GET",
          pathname: "/guidance",
          ifNoneMatch: `"${guidance.contentHash}"`,
        })
      ).status,
    ).toBe(304);
    expect(
      (await save({ ...entry, phone: "+421 000 000 002" }, 2)).status,
    ).toBe(200);
    expect(
      parsePublicGuidance((await publicResponse()).body).contactDirectory
        ?.entries[0]?.phone,
    ).toBe(entry.phone);
    expect((await publish(3)).status).toBe(200);
    const second = await request({
      method: "GET",
      pathname: "/guidance",
      ifNoneMatch: `"${guidance.contentHash}"`,
    });
    expect(second.status).toBe(200);
    const next = parsePublicGuidance(second.body);
    expect(next.contentHash).not.toBe(guidance.contentHash);
    expect(next.kinds).toEqual(guidance.kinds);
    expect(next.contactDirectory?.entries[0]?.phone).toBe("+421 000 000 002");
    const releaseId = guidance.contactDirectory?.revisionId;
    if (!releaseId) throw new Error("published directory required");
    expect(
      (await loadContactDirectoryRelease(sql, releaseId))?.entries,
    ).toEqual([entry]);
  });

  it("hides disabled entries and removes published contacts only after explicit publication", async () => {
    const entry = syntheticContactDirectoryEntry();
    await save(entry);
    await publish(1);
    await save({ ...entry, enabled: false, sourceUrl: "" }, 2);
    expect(
      parsePublicGuidance((await publicResponse()).body).contactDirectory
        ?.entries,
    ).toHaveLength(1);
    await publish(3);
    expect(
      parsePublicGuidance((await publicResponse()).body).contactDirectory
        ?.entries,
    ).toEqual([]);
    expect((await read()).hasUnpublishedChanges).toBe(false);
    expect(
      (await command({ type: "remove_entry", id: entry.id }, 4)).status,
    ).toBe(200);
    expect((await read()).document.entries).toEqual([]);
    expect((await read()).hasUnpublishedChanges).toBe(true);
  });

  it("replays accepted requests without duplicate writes and rejects stale or reused command IDs", async () => {
    const entry = syntheticContactDirectoryEntry();
    const id = randomUUID();
    expect((await save(entry, 0, id)).status).toBe(200);
    expect((await save(entry, 0, id)).status).toBe(200);
    expect((await read()).revision).toBe(1);
    expect(
      (await save({ ...entry, name: "Different content" }, 0, id)).status,
    ).toBe(409);
    expect((await save({ ...entry, name: "Stale edit" }, 0)).status).toBe(409);
    const publishId = randomUUID();
    expect((await publish(1, publishId)).status).toBe(200);
    expect((await publish(1, publishId)).status).toBe(200);
    expect(
      await sql`select revision_id from ah.contact_directory_revisions`,
    ).toHaveLength(1);
    expect(
      await sql`select audit_id from ah.audit_events where action = 'contact_directory_publish' and stream_id = ${publishId}`,
    ).toHaveLength(1);
  });

  it("accepts only one concurrent edit of the same revision", async () => {
    const entry = syntheticContactDirectoryEntry();
    const results = await Promise.all([
      save(entry),
      save({ ...entry, name: "Other operator edit" }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect((await read()).revision).toBe(1);
  });

  it("keeps copy drafts private and preserves both copy and contacts when publishers race", async () => {
    const entry = syntheticContactDirectoryEntry();
    await save(entry);
    await publish(1);
    const previous = parsePublicGuidance((await publicResponse()).body);
    const editor = await request({
      method: "GET",
      pathname: "/admin/guidance/kind/injured/domestic_cat",
    });
    const edited = await request({
      method: "POST",
      pathname: "/admin/guidance/cells",
      body: {
        expectedHash: (editor.body as { contentHash: string }).contentHash,
        kindKey: "domestic_cat",
        instructionKey: "contact.primary",
        applicability: "on",
        copy: {
          "contact.primary.title": "Synthetic new contact title",
          "contact.primary.body": "Synthetic new guide instructions.",
        },
      },
    });
    expect(edited.status).toBe(200);
    await save({ ...entry, name: "Synthetic updated contact" }, 2);
    expect((await publish(3)).status).toBe(200);
    expect(parsePublicGuidance((await publicResponse()).body).kinds).toEqual(
      previous.kinds,
    );
    await save({ ...entry, name: "Synthetic latest contact" }, 4);
    const results = await Promise.all([
      publish(5),
      request({
        method: "POST",
        pathname: "/admin/guidance/publish",
        body: {
          expectedHash: (edited.body as { contentHash: string }).contentHash,
          description: "Synthetic copy publication",
        },
      }),
    ]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    const current = parsePublicGuidance((await publicResponse()).body);
    expect(current.contactDirectory?.entries[0]?.name).toBe(
      "Synthetic latest contact",
    );
    expect(
      current.kinds.domestic_cat?.items.find(
        (item) => item.instructionKey === "contact.primary",
      )?.slots["contact.primary.body"],
    ).toBe("Synthetic new guide instructions.");
    expect((await read()).hasUnpublishedChanges).toBe(false);
  });
});
