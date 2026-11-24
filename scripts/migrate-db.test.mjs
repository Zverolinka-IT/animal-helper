import assert from "node:assert/strict";
import { test } from "node:test";

import { runDatabaseMigrations } from "./migrate-db.mjs";

test("production preflight only checks the primary database", async () => {
  const calls = [];
  await runDatabaseMigrations({
    check: true,
    env: {
      DATABASE_ENVIRONMENT: "production",
      DATABASE_URL: "postgresql://example.invalid/animal_helper",
      DATABASE_MIGRATION_URL:
        "postgresql://direct.example.invalid/animal_helper",
      DATABASE_TEST_URL: "postgresql://example.invalid/animal_helper_test",
    },
    run: async (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].at(-1), "--check");
  assert.equal(
    calls[0][2].environment.DATABASE_MIGRATION_URL,
    "postgresql://direct.example.invalid/animal_helper",
  );
});
