import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyCheckoutLocalEnvironment,
  ensureLocalDbEnvironment,
  loadLocalDbEnvironment,
  resolveIntegrationDatabaseUrl,
} from "./local-db-env.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const migrateCli = path.join(
  repositoryRoot,
  "packages",
  "event-store",
  "src",
  "migrate-cli.ts",
);
const ensureIntegrationCli = path.join(
  repositoryRoot,
  "packages",
  "event-store",
  "src",
  "ensure-integration-database-cli.ts",
);
const stripTypesResolve = pathToFileURL(
  path.join(scriptDirectory, "strip-types-resolve.mjs"),
).href;

/**
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, run?: typeof runCommand, check?: boolean }} [options]
 */
export async function runDatabaseMigrations(options = {}) {
  const cwd = path.resolve(options.cwd ?? repositoryRoot);
  const run = options.run ?? runCommand;
  const environment = await resolveMigrationEnvironment(cwd, options.env);

  if (
    environment.DATABASE_URL === undefined ||
    environment.DATABASE_URL.length === 0
  ) {
    throw new Error(
      "DATABASE_URL is required. For local development run `pnpm db:up`.",
    );
  }

  await run(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      stripTypesResolve,
      migrateCli,
      ...(options.check ? ["--check"] : []),
    ],
    { cwd, environment },
  );

  // A status check must never create or migrate the integration database.
  if (options.check) return;

  const testUrl = resolveIntegrationDatabaseUrl(environment);
  if (testUrl === undefined) {
    return;
  }

  await run(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      stripTypesResolve,
      ensureIntegrationCli,
    ],
    { cwd, environment },
  );
  await run(
    process.execPath,
    ["--experimental-strip-types", "--import", stripTypesResolve, migrateCli],
    {
      cwd,
      environment: {
        ...environment,
        DATABASE_URL: testUrl,
        DATABASE_MIGRATION_URL: testUrl,
      },
    },
  );
}

/**
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
async function resolveMigrationEnvironment(cwd, baseEnv = process.env) {
  if (baseEnv.DATABASE_ENVIRONMENT === "production") {
    return { ...baseEnv };
  }

  const env = { ...baseEnv };
  applyCheckoutLocalEnvironment(cwd, env);
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL.length > 0) {
    return env;
  }

  await ensureLocalDbEnvironment({ cwd });
  const loaded = await loadLocalDbEnvironment({ cwd, baseEnv });
  return loaded.environment;
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${signal ?? `code ${code}`}.`));
    });
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--check")) {
      throw new Error("Usage: migrate-db.mjs [--check]");
    }
    await runDatabaseMigrations({ check: args.includes("--check") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
