import postgres from "postgres";

import {
  createSqlOptions,
  readDatabaseName,
  resolveMigrationUrl,
} from "./connection.js";
import {
  applyMigrations,
  defaultMigrationsDirectory,
  inspectMigrations,
} from "./migrations.js";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check")) {
  throw new Error("Usage: migrate-cli.ts [--check]");
}

const databaseUrl = resolveMigrationUrl(process.env);
const sql = postgres(databaseUrl, createSqlOptions(process.env, { max: 1 }));

try {
  const plan = await inspectMigrations(sql, defaultMigrationsDirectory);
  console.log(JSON.stringify(plan, null, 2));
  if (!args.includes("--check")) {
    await applyMigrations(sql, defaultMigrationsDirectory);
    console.log(
      `Database migrations are up to date (${readDatabaseName(databaseUrl)}).`,
    );
  }
} finally {
  await sql.end();
}
