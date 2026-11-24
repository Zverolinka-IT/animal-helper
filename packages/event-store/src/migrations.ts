import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Sql } from "postgres";

export const defaultMigrationsDirectory = path.resolve(
  fileURLToPath(new URL("../../../supabase/migrations", import.meta.url)),
);

const MIGRATION_FILENAME = /^\d+_[a-z0-9_-]+\.sql$/;
const MIGRATION_LOCK = "animal-helper-schema-migrations";

type AppliedMigration = {
  filename: string;
  checksum: string | null;
};

export const migrationChecksum = (contents: string): string =>
  createHash("sha256").update(contents, "utf8").digest("hex");

/** Inspect the ledger without creating tables, taking migration locks or writing. */
export const inspectMigrations = async (
  sql: Sql,
  migrationsDirectory: string = defaultMigrationsDirectory,
): Promise<{
  applied: number;
  pending: { filename: string; checksum: string }[];
}> => {
  const files = (await readdir(migrationsDirectory))
    .filter((name) => MIGRATION_FILENAME.test(name))
    .sort();
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe("begin isolation level repeatable read read only");
    const [ledger] = await reserved`
      select to_regclass('public.schema_migrations') is not null as exists
    `;
    const rows = ledger?.exists
      ? await reserved<AppliedMigration[]>`
          select filename, checksum from public.schema_migrations
        `
      : [];
    const applied = new Map(rows.map((row) => [row.filename, row.checksum]));
    const pending = [];
    for (const filename of files) {
      const checksum = migrationChecksum(
        await readFile(path.join(migrationsDirectory, filename), "utf8"),
      );
      if (!applied.has(filename)) {
        pending.push({ filename, checksum });
      } else if (applied.get(filename) !== checksum) {
        throw new Error(
          `Applied migration ${filename} has changed or has no checksum`,
        );
      }
    }
    const missing = rows.filter((row) => !files.includes(row.filename));
    if (missing.length > 0) {
      throw new Error(
        `Applied migrations missing from release: ${missing.map((row) => row.filename).join(", ")}`,
      );
    }
    return { applied: rows.length, pending };
  } finally {
    try {
      await reserved.unsafe("rollback");
    } finally {
      reserved.release();
    }
  }
};

export const applyMigrations = async (
  sql: Sql,
  migrationsDirectory: string = defaultMigrationsDirectory,
): Promise<void> => {
  const files = (await readdir(migrationsDirectory))
    .filter((name) => MIGRATION_FILENAME.test(name))
    .sort();

  const reserved = await sql.reserve();
  try {
    await reserved.unsafe("begin");
    try {
      await applyReservedMigrations(reserved, files, migrationsDirectory);
      await reserved.unsafe("commit");
    } catch (error) {
      try {
        await reserved.unsafe("rollback");
      } catch {
        // Keep the migration failure; rollback errors are secondary.
      }
      throw error;
    }
  } finally {
    reserved.release();
  }
};

const applyReservedMigrations = async (
  sql: Sql,
  files: readonly string[],
  migrationsDirectory: string,
): Promise<void> => {
  await sql`
    create table if not exists public.schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;
  await sql.unsafe(
    "alter table public.schema_migrations add column if not exists checksum text",
  );
  await sql`select pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK}))`;

  const appliedRows = await sql<AppliedMigration[]>`
    select filename, checksum from public.schema_migrations
  `;
  const applied = new Map(
    appliedRows.map((row) => [row.filename, row.checksum]),
  );

  for (const file of files) {
    const filePath = path.join(migrationsDirectory, file);
    const contents = await readFile(filePath, "utf8");
    const checksum = migrationChecksum(contents);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous === null || previous.length === 0) {
        throw new Error(
          `Applied migration ${file} has no checksum; reset the local database with pnpm db:reset`,
        );
      }
      if (previous !== checksum) {
        throw new Error(`Applied migration ${file} has changed`);
      }
      continue;
    }

    await sql.file(filePath);
    await sql`
      insert into public.schema_migrations (filename, checksum)
      values (${file}, ${checksum})
    `;
  }
};
