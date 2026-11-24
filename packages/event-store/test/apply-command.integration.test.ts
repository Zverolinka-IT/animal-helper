import "./load-local-env.js";

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  parseCaseCommand,
  syntheticAttachPrivateDataCommand,
  syntheticCreateDraftCommand,
  syntheticSubmitDraftCommand,
  syntheticFormSnapshot,
  syntheticLocationPayload,
  syntheticContactPayload,
  toDomainCaseCommand,
} from "@animal-helper/contracts";
import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import postgres, { type Sql } from "postgres";

import { applyCommandInTransaction } from "../src/apply-command.js";
import { inspectMigrations } from "../src/migrations.js";

import {
  applyCommand,
  applyMigrations,
  createSqlOptions,
  defaultMigrationsDirectory,
  ensureIntegrationDatabase,
  getPublicStatus,
  hashCapability,
  hashCommandContent,
  loadRecordedEvents,
  parseCapabilityPepper,
  readDatabaseName,
  rebuildCaseProjections,
  resolveIntegrationDatabaseUrl,
  type ApplyCommandInput,
} from "../src/index.js";

const integrationDatabaseUrl = resolveIntegrationDatabaseUrl(process.env);
const pepper = parseCapabilityPepper(
  process.env.CAPABILITY_PEPPER ??
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
);

const now = new Date("2026-08-22T12:00:00.000Z");

const parsed = (value: unknown) => {
  const result = parseCaseCommand(value);
  if (!result.success) {
    throw new Error("synthetic command failed contract validation");
  }

  return result.data;
};

const inputFrom = (
  command: unknown,
  extras: Partial<ApplyCommandInput> = {},
): ApplyCommandInput => {
  const transport = parsed(command);

  return {
    commandId: transport.commandId,
    streamId: transport.streamId,
    expectedVersion: transport.expectedVersion,
    occurredAt: transport.occurredAt,
    correlationId: transport.correlationId,
    actorKind:
      transport.type === "start_review" ||
      transport.type === "complete_case" ||
      transport.type === "purge_private_data"
        ? "administrator"
        : transport.type === "expire_draft"
          ? "system"
          : "reporter",
    domainCommand: toDomainCaseCommand(transport),
    contentHash: hashCommandContent(transport),
    now,
    ...(transport.type === "attach_private_data"
      ? {
          privateRecord: {
            id: transport.privateRecordId,
            payload: transport.privatePayload,
          },
        }
      : {}),
    ...extras,
  };
};

describe.skipIf(integrationDatabaseUrl === undefined)(
  "event-store integration",
  () => {
    let sql: Sql;

    beforeAll(async () => {
      const databaseUrl = await ensureIntegrationDatabase(process.env);
      if (databaseUrl === undefined) {
        throw new Error("DATABASE_TEST_URL is required");
      }

      sql = postgres(databaseUrl, createSqlOptions(process.env, { max: 4 }));
      expect(readDatabaseName(databaseUrl)).toMatch(/_test$/u);
      await sql`drop schema if exists ah cascade`;
      await sql`drop table if exists public.schema_migrations`;
      await applyMigrations(sql, defaultMigrationsDirectory);
    });

    beforeEach(async () => {
      await sql`
      truncate
        ah.audit_events,
        ah.outbox,
        ah.case_queue_projection,
        ah.case_status_projection,
        ah.capabilities,
        ah.private_records,
        ah.accepted_commands,
        ah.events,
        ah.streams
      cascade
    `;
    });

    afterAll(async () => {
      await sql.end();
    });

    const attachRequired = async (expectedVersion: number) => {
      for (const record of [
        { kind: "location", privatePayload: syntheticLocationPayload },
        { kind: "form_snapshot", privatePayload: syntheticFormSnapshot },
        { kind: "contact", privatePayload: syntheticContactPayload },
      ]) {
        const result = await applyCommand(
          sql,
          inputFrom({
            ...syntheticAttachPrivateDataCommand,
            ...record,
            expectedVersion: expectedVersion++,
            commandId: randomUUID(),
            privateRecordId: randomUUID(),
          }),
        );
        expect(result.ok).toBe(true);
      }
      return expectedVersion;
    };

    it("appends, projects, and enqueues outbox work in one transaction", async () => {
      const capability = randomBytes(32);
      const created = await applyCommand(
        sql,
        inputFrom(syntheticCreateDraftCommand, {
          capabilityHash: hashCapability(capability, pepper),
        }),
      );

      expect(created).toMatchObject({
        ok: true,
        value: {
          outcome: "applied",
          committedVersion: 1,
          publicState: "draft",
        },
      });

      const attached = await applyCommand(
        sql,
        inputFrom(syntheticAttachPrivateDataCommand),
      );
      expect(attached.ok).toBe(true);

      await attachRequired(2);
      const submitted = await applyCommand(
        sql,
        inputFrom({ ...syntheticSubmitDraftCommand, expectedVersion: 5 }),
      );
      expect(submitted).toMatchObject({
        ok: true,
        value: { publicState: "received" },
      });

      const events = await loadRecordedEvents(
        sql,
        syntheticCreateDraftCommand.streamId,
      );
      expect(events.map((event) => event.type)).toEqual([
        "case.draft_created",
        "case.private_data_attached",
        "case.private_data_attached",
        "case.private_data_attached",
        "case.private_data_attached",
        "case.draft_submitted",
      ]);
      expect(JSON.stringify(events)).not.toContain("synthetic-case-notes");
      expect(JSON.stringify(events)).not.toContain(capability.toString("hex"));

      const [privateRow] = await sql<{ payload: unknown }[]>`
      select payload
      from ah.private_records
      where private_record_id = ${syntheticAttachPrivateDataCommand.privateRecordId}::uuid
    `;
      expect(privateRow?.payload).toEqual({
        syntheticNotes: "synthetic-case-notes",
      });

      const [capabilityRow] = await sql<
        { mutation_allowed: boolean; expires_at: Date | null }[]
      >`
      select mutation_allowed, expires_at
      from ah.capabilities
      where stream_id = ${syntheticCreateDraftCommand.streamId}::uuid
    `;
      expect(capabilityRow).toEqual({
        mutation_allowed: false,
        expires_at: null,
      });

      const outbox = await sql<{ effect_type: string }[]>`
      select effect_type from ah.outbox order by created_at
    `;
      expect(outbox.map((row) => row.effect_type)).toEqual([
        "schedule_draft_expiry",
        "notify_case_queued",
      ]);

      await expect(
        getPublicStatus(sql, syntheticCreateDraftCommand.streamId),
      ).resolves.toMatchObject({
        publicState: "received",
      });
    });

    it("returns the original outcome for an idempotent retry and rejects a reused id", async () => {
      const first = await applyCommand(
        sql,
        inputFrom(syntheticCreateDraftCommand, {
          capabilityHash: hashCapability(randomBytes(32), pepper),
        }),
      );
      const retry = await applyCommand(
        sql,
        inputFrom(syntheticCreateDraftCommand, {
          capabilityHash: hashCapability(randomBytes(32), pepper),
        }),
      );

      expect(first.ok).toBe(true);
      expect(retry).toMatchObject({
        ok: true,
        value: { outcome: "duplicate", committedVersion: 1 },
      });

      const conflicted = await applyCommand(
        sql,
        inputFrom(
          {
            ...syntheticCreateDraftCommand,
            occurredAt: "2026-08-22T13:00:00.000Z",
          },
          {
            capabilityHash: hashCapability(randomBytes(32), pepper),
          },
        ),
      );

      expect(conflicted).toEqual({
        ok: false,
        error: { code: "COMMAND_CONTENT_MISMATCH" },
      });

      const [eventCount] = await sql<{ count: string }[]>`
      select count(*)::text as count from ah.events
    `;
      expect(eventCount?.count).toBe("1");
    });

    it("acknowledges simultaneous retries of create and attach exactly once", async () => {
      const create = inputFrom(syntheticCreateDraftCommand, {
        capabilityHash: hashCapability(randomBytes(32), pepper),
      });
      const creates = await Promise.all(
        Array.from({ length: 8 }, () => applyCommand(sql, create)),
      );
      expect(creates.every((result) => result.ok)).toBe(true);
      expect(
        creates.filter(
          (result) => result.ok && result.value.outcome === "applied",
        ),
      ).toHaveLength(1);
      const attach = inputFrom(syntheticAttachPrivateDataCommand);
      const attaches = await Promise.all(
        Array.from({ length: 8 }, () => applyCommand(sql, attach)),
      );
      expect(attaches.every((result) => result.ok)).toBe(true);
      expect(
        attaches.filter(
          (result) => result.ok && result.value.outcome === "applied",
        ),
      ).toHaveLength(1);
      expect(await loadRecordedEvents(sql, create.streamId)).toHaveLength(2);
      expect(
        await sql`select private_record_id from ah.private_records`,
      ).toHaveLength(1);
    });

    it("records server time and keeps it monotonic despite forged client clocks", async () => {
      await applyCommand(
        sql,
        inputFrom(
          {
            ...syntheticCreateDraftCommand,
            occurredAt: "2099-01-01T00:00:00.000Z",
          },
          {
            capabilityHash: hashCapability(randomBytes(32), pepper),
          },
        ),
      );
      await applyCommand(
        sql,
        inputFrom(
          {
            ...syntheticAttachPrivateDataCommand,
            occurredAt: "2000-01-01T00:00:00.000Z",
          },
          {
            now: new Date(now.getTime() - 1000),
          },
        ),
      );
      const events = await loadRecordedEvents(
        sql,
        syntheticCreateDraftCommand.streamId,
      );
      expect(events.map((event) => event.occurredAt)).toEqual([
        now.toISOString(),
        now.toISOString(),
      ]);
      await rebuildCaseProjections(sql, syntheticCreateDraftCommand.streamId);
      expect(
        await getPublicStatus(sql, syntheticCreateDraftCommand.streamId),
      ).toMatchObject({
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    });

    it("waits for an in-flight close before rebuilding either projection", async () => {
      const streamId = syntheticCreateDraftCommand.streamId;
      await applyCommand(
        sql,
        inputFrom(syntheticCreateDraftCommand, {
          capabilityHash: hashCapability(randomBytes(32), pepper),
        }),
      );
      await attachRequired(1);
      await applyCommand(
        sql,
        inputFrom({ ...syntheticSubmitDraftCommand, expectedVersion: 4 }),
      );
      let release!: () => void;
      let ready!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const writer = sql.begin(async (transaction) => {
        const tx = transaction as unknown as Sql;
        for (const [offset, type] of (
          ["start_review", "complete_case"] as const
        ).entries()) {
          const result = await applyCommandInTransaction(
            tx,
            inputFrom({
              ...syntheticSubmitDraftCommand,
              type,
              commandId: randomUUID(),
              expectedVersion: 5 + offset,
            }),
          );
          expect(result.ok).toBe(true);
        }
        ready();
        await held;
      });
      await locked;
      const state = { finished: false };
      const rebuilding = rebuildCaseProjections(sql, streamId).finally(() => {
        state.finished = true;
      });
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !state.finished; attempt++) {
          const [row] = await sql<{ waiting: boolean }[]>`select exists(
            select 1 from pg_stat_activity where datname = current_database()
              and wait_event_type = 'Lock' and query like '%for update%'
          ) as waiting`;
          waiting = row?.waiting === true;
          if (waiting) break;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(waiting).toBe(true);
        expect(state.finished).toBe(false);
      } finally {
        release();
      }
      await writer;
      expect(await rebuilding).toMatchObject({ ok: true });
      expect(await getPublicStatus(sql, streamId)).toMatchObject({
        publicState: "closed",
      });
      const [queue] = await sql<
        { workflow_state: string }[]
      >`select workflow_state from ah.case_queue_projection where stream_id = ${streamId}::uuid`;
      expect(queue?.workflow_state).toBe("completed");
    });

    it("rejects a stale expected version without appending", async () => {
      await applyCommand(
        sql,
        inputFrom(syntheticCreateDraftCommand, {
          capabilityHash: hashCapability(randomBytes(32), pepper),
        }),
      );

      const stale = await applyCommand(
        sql,
        inputFrom({
          ...syntheticAttachPrivateDataCommand,
          expectedVersion: 0,
          commandId: randomUUID(),
        }),
      );

      expect(stale).toEqual({
        ok: false,
        error: { code: "VERSION_CONFLICT" },
      });

      const [eventCount] = await sql<{ count: string }[]>`
      select count(*)::text as count from ah.events
    `;
      expect(eventCount?.count).toBe("1");
    });

    it("purges private payloads while keeping the event history and rebuilt projections", async () => {
      await applyCommand(
        sql,
        inputFrom(syntheticCreateDraftCommand, {
          capabilityHash: hashCapability(randomBytes(32), pepper),
        }),
      );
      await applyCommand(sql, inputFrom(syntheticAttachPrivateDataCommand));
      await attachRequired(2);
      await applyCommand(
        sql,
        inputFrom({ ...syntheticSubmitDraftCommand, expectedVersion: 5 }),
      );
      await applyCommand(
        sql,
        inputFrom({
          type: "start_review",
          schemaVersion: 1,
          commandId: randomUUID(),
          streamId: syntheticCreateDraftCommand.streamId,
          expectedVersion: 6,
          occurredAt: "2026-08-22T12:00:00.000Z",
          correlationId: syntheticCreateDraftCommand.correlationId,
        }),
      );
      await applyCommand(
        sql,
        inputFrom({
          type: "complete_case",
          schemaVersion: 1,
          commandId: randomUUID(),
          streamId: syntheticCreateDraftCommand.streamId,
          expectedVersion: 7,
          occurredAt: "2026-08-22T12:00:00.000Z",
          correlationId: syntheticCreateDraftCommand.correlationId,
        }),
      );

      await sql`insert into ah.admin_case_work (stream_id, document) values (
        ${syntheticCreateDraftCommand.streamId}::uuid,
        '{"note":"synthetic-private-admin-note","volunteer":{"name":"Synthetic volunteer"}}'::jsonb
      )`;

      const purged = await applyCommand(
        sql,
        inputFrom({
          type: "purge_private_data",
          schemaVersion: 1,
          commandId: randomUUID(),
          streamId: syntheticCreateDraftCommand.streamId,
          expectedVersion: 8,
          occurredAt: "2026-08-22T12:00:00.000Z",
          correlationId: syntheticCreateDraftCommand.correlationId,
        }),
      );

      expect(purged).toMatchObject({
        ok: true,
        value: { publicState: "closed" },
      });

      const [privateRow] = await sql<
        { payload: unknown; deleted_at: Date | null }[]
      >`
      select payload, deleted_at
      from ah.private_records
      where stream_id = ${syntheticCreateDraftCommand.streamId}::uuid
    `;
      expect(
        await sql`select stream_id from ah.admin_case_work where stream_id = ${syntheticCreateDraftCommand.streamId}::uuid`,
      ).toHaveLength(0);
      expect(privateRow?.payload).toBeNull();
      expect(privateRow?.deleted_at).not.toBeNull();

      const events = await loadRecordedEvents(
        sql,
        syntheticCreateDraftCommand.streamId,
      );
      expect(events.map((event) => event.type)).toContain(
        "case.private_data_purged",
      );
      expect(JSON.stringify(events)).not.toContain("synthetic-case-notes");

      await sql`
      update ah.case_queue_projection
      set workflow_state = 'draft'
      where stream_id = ${syntheticCreateDraftCommand.streamId}::uuid
    `;

      const rebuilt = await rebuildCaseProjections(
        sql,
        syntheticCreateDraftCommand.streamId,
      );
      expect(rebuilt).toEqual({ ok: true, eventCount: 9 });

      const [queue] = await sql<{ workflow_state: string }[]>`
      select workflow_state
      from ah.case_queue_projection
      where stream_id = ${syntheticCreateDraftCommand.streamId}::uuid
    `;
      expect(queue?.workflow_state).toBe("completed");

      const outboxCount = await sql<{ count: string }[]>`
      select count(*)::text as count from ah.outbox
    `;
      expect(outboxCount[0]?.count).toBe("3");
    });

    it("rejects direct event inserts", async () => {
      await sql`
      insert into ah.streams (stream_id)
      values (${syntheticCreateDraftCommand.streamId}::uuid)
    `;

      await expect(
        sql`
        insert into ah.events (
          event_id,
          stream_id,
          stream_version,
          event_type,
          schema_version,
          occurred_at,
          actor_kind,
          command_id,
          correlation_id,
          payload
        )
        values (
          ${randomUUID()}::uuid,
          ${syntheticCreateDraftCommand.streamId}::uuid,
          1,
          'case.draft_created',
          1,
          now(),
          'reporter',
          ${randomUUID()}::uuid,
          ${randomUUID()}::uuid,
          '{}'::jsonb
        )
      `,
      ).rejects.toThrow(/append-only/);
    });

    it("is safe to apply the same migrations more than once", async () => {
      await applyMigrations(sql, defaultMigrationsDirectory);
      await applyMigrations(sql, defaultMigrationsDirectory);
    });

    it("checks pending migrations without applying them or changing the ledger", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "ah-plan-"));
      const { readdir, copyFile } = await import("node:fs/promises");
      const before =
        await sql`select * from public.schema_migrations order by filename`;
      try {
        for (const filename of await readdir(defaultMigrationsDirectory)) {
          if (filename.endsWith(".sql")) {
            await copyFile(
              path.join(defaultMigrationsDirectory, filename),
              path.join(directory, filename),
            );
          }
        }
        const filename = "20990101000000_preflight.sql";
        await writeFile(path.join(directory, filename), "select 1;\n");
        const plan = await inspectMigrations(sql, directory);
        expect(plan.applied).toBe(before.length);
        expect(plan.pending).toHaveLength(1);
        expect(plan.pending[0]?.filename).toBe(filename);
        expect(plan.pending[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
        await writeFile(
          path.join(directory, String(before[0]?.filename)),
          "select 2;\n",
        );
        await expect(inspectMigrations(sql, directory)).rejects.toThrow(
          /has changed/,
        );
        expect(
          await sql`select * from public.schema_migrations order by filename`,
        ).toEqual(before);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("upgrades existing guidance without changing hashes, cells or publication pointers", async () => {
      // Everything, including removal of the column to model the old schema,
      // is rolled back in this synthetic test database.
      const connection = await sql.reserve();
      const revisionId = randomUUID();
      const hash = "a".repeat(64);
      try {
        await connection.unsafe("begin");
        await connection`alter table ah.guidance_revisions drop column report_profiles`;
        await connection`
          insert into ah.guidance_revisions
            (revision_id, flow_key, schema_version, locale, jurisdiction, status,
             created_by, created_at, updated_at, published_at, description, content_hash)
          values (${revisionId}::uuid, 'migration-test', 1, 'sk-SK', 'SK', 'published',
                  'synthetic', now(), now(), now(), 'Synthetic migration fixture', ${hash})
        `;
        await connection`
          insert into ah.guidance_cells
            (revision_id, kind_key, instruction_key, applicability, sort_order, copy_json)
          values (${revisionId}::uuid, 'dog', 'warning', 'on', 1, '{"title":"Synthetic"}'::jsonb)
        `;
        await connection`
          insert into ah.guidance_publications
            (flow_key, schema_version, locale, jurisdiction, active_revision_id, published_at)
          values ('migration-test', 1, 'sk-SK', 'SK', ${revisionId}::uuid, now())
        `;
        const before =
          await connection`select * from ah.guidance_revisions where revision_id = ${revisionId}`;
        const cells =
          await connection`select * from ah.guidance_cells where revision_id = ${revisionId}`;
        const publications =
          await connection`select * from ah.guidance_publications where active_revision_id = ${revisionId}`;
        await connection.file(
          path.join(
            defaultMigrationsDirectory,
            "20261022160000_report_guidance_profiles.sql",
          ),
        );
        expect(
          await connection`select revision.* from ah.guidance_revisions revision where revision_id = ${revisionId}`,
        ).toEqual([{ ...before[0], report_profiles: [] }]);
        expect(
          await connection`select * from ah.guidance_cells where revision_id = ${revisionId}`,
        ).toEqual(cells);
        expect(
          await connection`select * from ah.guidance_publications where active_revision_id = ${revisionId}`,
        ).toEqual(publications);
        await connection.unsafe("savepoint invalid_profile");
        await expect(
          connection`update ah.guidance_revisions set report_profiles = '{}'::jsonb where revision_id = ${revisionId}`,
        ).rejects.toThrow(/check constraint/);
        await connection.unsafe("rollback to savepoint invalid_profile");
      } finally {
        await connection.unsafe("rollback");
        connection.release();
      }
    });

    it("rejects an edited applied migration", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "ah-mig-"));
      const table = `mig_${randomBytes(6).toString("hex")}`;
      const filename = "20260101000000_once.sql";
      try {
        await writeFile(
          path.join(directory, filename),
          `create table public.${table} (id integer);\n`,
          "utf8",
        );
        await applyMigrations(sql, directory);
        await writeFile(
          path.join(directory, filename),
          `create table public.${table} (id integer, extra integer);\n`,
          "utf8",
        );
        await expect(applyMigrations(sql, directory)).rejects.toThrow(
          /has changed/,
        );
      } finally {
        await sql.unsafe(`drop table if exists public.${table}`);
        await sql`delete from public.schema_migrations where filename = ${filename}`;
        await rm(directory, { recursive: true, force: true });
      }
    });
  },
);
