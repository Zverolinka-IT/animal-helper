import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  applyCheckoutLocalEnvironment,
  applyMigrations,
  bootstrapOperator,
  createSqlOptions,
  defaultMigrationsDirectory,
  deleteOperatorAccount,
  ensureIntegrationDatabase,
  parseCapabilityPepper,
  readDatabaseName,
  resolveIntegrationDatabaseUrl,
} from "@animal-helper/event-store";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadAdminConfig } from "../src/admin/config.js";
import { createApiHandler, type ApiRequest } from "../src/handler.js";
import { createMemoryGateway } from "../src/memory-gateway.js";

import { softwarePasskey } from "./software-passkey.js";

applyCheckoutLocalEnvironment(
  path.resolve(import.meta.dirname, "../../.."),
  process.env,
);

const databaseUrl = resolveIntegrationDatabaseUrl(process.env);
const pepper = parseCapabilityPepper(
  process.env.CAPABILITY_PEPPER ??
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
);

const origin = "http://127.0.0.1:5174";
const host = "127.0.0.1:5174";

const cookieHeader = (cookies: readonly string[] | undefined): string =>
  (cookies ?? [])
    .map((cookie) => cookie.split(";")[0])
    .filter((part) => part !== undefined && part.length > 0)
    .join("; ");

describe.skipIf(databaseUrl === undefined)(
  "admin passkey authentication",
  () => {
    let sql: Sql;
    let handle: ReturnType<typeof createApiHandler>;
    const createdEmails: string[] = [];
    const config = loadAdminConfig({
      DATABASE_ENVIRONMENT: "local",
      ADMIN_ORIGIN: origin,
    });
    if (config === undefined) {
      throw new Error("admin config");
    }

    const request = (
      partial: Partial<ApiRequest> & Pick<ApiRequest, "method" | "pathname">,
    ) =>
      handle({
        search: "",
        authorization: undefined,
        body: undefined,
        origin,
        host,
        ...partial,
      });

    beforeAll(async () => {
      if (databaseUrl === undefined) {
        throw new Error("DATABASE_TEST_URL is required");
      }
      const integrationUrl = await ensureIntegrationDatabase(process.env);
      if (integrationUrl === undefined) {
        throw new Error("DATABASE_TEST_URL is required");
      }
      sql = postgres(integrationUrl, createSqlOptions(process.env, { max: 1 }));
      expect(readDatabaseName(integrationUrl)).toMatch(/_test$/u);
      handle = createApiHandler({
        gateway: createMemoryGateway(),
        pepper,
        admin: { sql, config },
      });
      await applyMigrations(sql, defaultMigrationsDirectory);
    });

    afterAll(async () => {
      for (const email of createdEmails) {
        await deleteOperatorAccount(sql, email);
      }
      await sql.end();
    });

    it("registers a passkey from a bootstrap link, restores the session, and lists the queue", async () => {
      const email = `operator-${randomUUID()}@example.invalid`;
      createdEmails.push(email);
      const bootstrapToken = await bootstrapOperator(sql, email);
      const passkey = softwarePasskey();

      const optionsResponse = await request({
        method: "POST",
        pathname: "/admin/auth/register/options",
        body: { bootstrapToken },
      });
      expect(optionsResponse.status).toBe(200);
      const optionsBody = optionsResponse.body as {
        options: {
          rp: { id: string };
          challenge: string;
          user: { id: string };
        };
      };
      const ceremony = cookieHeader(optionsResponse.cookies);

      const verifyResponse = await request({
        method: "POST",
        pathname: "/admin/auth/register/verify",
        cookie: ceremony,
        body: { response: passkey.register(optionsBody.options, origin) },
      });
      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body).toMatchObject({
        operator: { email },
        environment: "local",
      });
      const session = cookieHeader(verifyResponse.cookies);

      const restored = await request({
        method: "GET",
        pathname: "/admin/session",
        cookie: session,
      });
      expect(restored.status).toBe(200);
      expect(restored.body).toMatchObject({
        operator: { email },
        environment: "local",
      });

      const replay = await request({
        method: "POST",
        pathname: "/admin/auth/register/verify",
        cookie: ceremony,
        body: { response: passkey.register(optionsBody.options, origin) },
      });
      expect(replay.status).toBe(401);

      const queue = await request({
        method: "GET",
        pathname: "/admin/queue",
        cookie: session,
      });
      expect(queue.status).toBe(200);
      const queueBody = queue.body as { cases: unknown };
      expect(Array.isArray(queueBody.cases)).toBe(true);
    });

    it("signs in with an existing passkey and rejects a customer origin", async () => {
      const email = `operator-${randomUUID()}@example.invalid`;
      createdEmails.push(email);
      const bootstrapToken = await bootstrapOperator(sql, email);
      const passkey = softwarePasskey();
      const optionsResponse = await request({
        method: "POST",
        pathname: "/admin/auth/register/options",
        body: { bootstrapToken },
      });
      const optionsBody = optionsResponse.body as {
        options: {
          rp: { id: string };
          challenge: string;
          user: { id: string };
        };
      };
      const registered = await request({
        method: "POST",
        pathname: "/admin/auth/register/verify",
        cookie: cookieHeader(optionsResponse.cookies),
        body: { response: passkey.register(optionsBody.options, origin) },
      });
      expect(registered.status).toBe(200);

      const loginOptions = await request({
        method: "POST",
        pathname: "/admin/auth/login/options",
      });
      expect(loginOptions.status).toBe(200);
      const loginBody = loginOptions.body as {
        options: {
          rpId: string;
          challenge: string;
          allowCredentials?: readonly { id: string }[];
        };
      };
      expect(
        loginBody.options.allowCredentials?.map((item) => item.id).length,
      ).toBeGreaterThan(0);
      const signedIn = await request({
        method: "POST",
        pathname: "/admin/auth/login/verify",
        cookie: cookieHeader(loginOptions.cookies),
        body: { response: passkey.authenticate(loginBody.options, origin) },
      });
      expect(signedIn.status).toBe(200);
      expect(signedIn.body).toMatchObject({ operator: { email } });

      const crossOrigin = await request({
        method: "POST",
        pathname: "/admin/auth/login/options",
        origin: "http://127.0.0.1:5173",
      });
      expect(crossOrigin.status).toBe(403);

      const anonymousQueue = await request({
        method: "GET",
        pathname: "/admin/queue",
      });
      expect(anonymousQueue.status).toBe(401);
    });

    it("edits injured copy, publishes it, and serves the override publicly", async () => {
      const snapshot = await snapshotGuidance(sql);
      await clearGuidance(sql);
      const email = `operator-${randomUUID()}@example.invalid`;
      createdEmails.push(email);

      try {
        const bootstrapToken = await bootstrapOperator(sql, email);
        const passkey = softwarePasskey();
        const optionsResponse = await request({
          method: "POST",
          pathname: "/admin/auth/register/options",
          body: { bootstrapToken },
        });
        const optionsBody = optionsResponse.body as {
          options: {
            rp: { id: string };
            challenge: string;
            user: { id: string };
          };
        };
        const registered = await request({
          method: "POST",
          pathname: "/admin/auth/register/verify",
          cookie: cookieHeader(optionsResponse.cookies),
          body: { response: passkey.register(optionsBody.options, origin) },
        });
        const session = cookieHeader(registered.cookies);

        const kind = await request({
          method: "GET",
          pathname: "/admin/guidance/kind/injured/domestic_cat",
          cookie: session,
        });
        expect(kind.status).toBe(200);
        const kindBody = kind.body as {
          contentHash: string;
          items: { instructionKey: string }[];
        };
        expect(
          kindBody.items.some(
            (item) => item.instructionKey === "warning.do_not",
          ),
        ).toBe(true);

        const saved = await request({
          method: "POST",
          pathname: "/admin/guidance/cells",
          cookie: session,
          body: {
            expectedHash: kindBody.contentHash,
            kindKey: "domestic_cat",
            instructionKey: "warning.do_not",
            applicability: "on",
            copy: {
              "warning.do_not": "Nesahejte na testovaciu mačku.",
            },
          },
        });
        expect(saved.status).toBe(200);
        const savedBody = saved.body as { contentHash: string };

        const published = await request({
          method: "POST",
          pathname: "/admin/guidance/publish",
          cookie: session,
          body: {
            expectedHash: savedBody.contentHash,
            description: "Testovacia publikácia kópie pre mačku.",
          },
        });
        expect(published.status).toBe(200);

        const publicGuidance = await request({
          method: "GET",
          pathname: "/guidance",
        });
        expect(publicGuidance.status).toBe(200);
        const publicBody = publicGuidance.body as {
          source: string;
          kinds: {
            domestic_cat?: {
              items: {
                instructionKey: string;
                slots: Record<string, string>;
              }[];
            };
          };
        };
        expect(publicBody.source).toBe("published");
        expect(
          publicBody.kinds.domestic_cat?.items.find(
            (item) => item.instructionKey === "warning.do_not",
          )?.slots["warning.do_not"],
        ).toBe("Nesahejte na testovaciu mačku.");

        const rejected = await request({
          method: "POST",
          pathname: "/admin/guidance/cells",
          cookie: session,
          body: {
            expectedHash: savedBody.contentHash,
            kindKey: "domestic_cat",
            instructionKey: "warning.do_not",
            applicability: "on",
            copy: { "warning.do_not": "http://example.test" },
          },
        });
        expect(rejected.status).toBe(400);
      } finally {
        await restoreGuidance(sql, snapshot);
      }
    }, 15_000);
  },
);

const jsonObject = (value: unknown): { [key: string]: string } => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as { [key: string]: string };
  }
  return {};
};

type GuidanceSnapshot = {
  revisions: {
    revision_id: string;
    flow_key: string;
    schema_version: number;
    locale: string;
    jurisdiction: string;
    status: string;
    based_on_revision_id: string | null;
    created_by: string;
    created_at: Date;
    updated_at: Date;
    published_at: Date | null;
    description: string | null;
    content_hash: string;
    source_references: string[];
    content_reviewed_at: Date | null;
  }[];
  copy: {
    revision_id: string;
    copy_slot_key: string;
    plain_text: string;
  }[];
  cells: {
    revision_id: string;
    kind_key: string;
    instruction_key: string;
    applicability: string;
    sort_order: number;
    copy_json: unknown;
    action_target_key: string | null;
  }[];
  publications: {
    flow_key: string;
    schema_version: number;
    locale: string;
    jurisdiction: string;
    active_revision_id: string;
    published_at: Date;
  }[];
};

const snapshotGuidance = async (sql: Sql): Promise<GuidanceSnapshot> => ({
  revisions: await sql`select * from ah.guidance_revisions`,
  copy: await sql`select * from ah.guidance_copy`,
  cells: await sql`select * from ah.guidance_cells`,
  publications: await sql`select * from ah.guidance_publications`,
});

const clearGuidance = async (sql: Sql): Promise<void> => {
  await sql`delete from ah.guidance_publications`;
  await sql`delete from ah.guidance_revisions`;
};

const restoreGuidance = async (
  sql: Sql,
  snapshot: GuidanceSnapshot,
): Promise<void> => {
  await clearGuidance(sql);
  for (const row of snapshot.revisions) {
    await sql`
      insert into ah.guidance_revisions (
        revision_id,
        flow_key,
        schema_version,
        locale,
        jurisdiction,
        status,
        created_by,
        created_at,
        updated_at,
        published_at,
        description,
        content_hash,
        source_references,
        content_reviewed_at
      )
      values (
        ${row.revision_id}::uuid,
        ${row.flow_key},
        ${row.schema_version},
        ${row.locale},
        ${row.jurisdiction},
        ${row.status},
        ${row.created_by},
        ${row.created_at},
        ${row.updated_at},
        ${row.published_at},
        ${row.description},
        ${row.content_hash},
        ${sql.array(row.source_references)},
        ${row.content_reviewed_at}
      )
    `;
  }
  for (const row of snapshot.revisions) {
    if (row.based_on_revision_id === null) {
      continue;
    }
    await sql`
      update ah.guidance_revisions
      set based_on_revision_id = ${row.based_on_revision_id}::uuid
      where revision_id = ${row.revision_id}::uuid
    `;
  }
  for (const row of snapshot.copy) {
    await sql`
      insert into ah.guidance_copy (revision_id, copy_slot_key, plain_text)
      values (
        ${row.revision_id}::uuid,
        ${row.copy_slot_key},
        ${row.plain_text}
      )
    `;
  }
  for (const row of snapshot.cells) {
    await sql`
      insert into ah.guidance_cells (
        revision_id,
        kind_key,
        instruction_key,
        applicability,
        sort_order,
        copy_json,
        action_target_key
      )
      values (
        ${row.revision_id}::uuid,
        ${row.kind_key},
        ${row.instruction_key},
        ${row.applicability},
        ${row.sort_order},
        ${JSON.stringify(jsonObject(row.copy_json))}::jsonb,
        ${row.action_target_key}
      )
    `;
  }
  for (const row of snapshot.publications) {
    await sql`
      insert into ah.guidance_publications (
        flow_key,
        schema_version,
        locale,
        jurisdiction,
        active_revision_id,
        published_at
      )
      values (
        ${row.flow_key},
        ${row.schema_version},
        ${row.locale},
        ${row.jurisdiction},
        ${row.active_revision_id}::uuid,
        ${row.published_at}
      )
    `;
  }
};
