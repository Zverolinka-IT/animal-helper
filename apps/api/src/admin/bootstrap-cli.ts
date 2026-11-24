import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import postgres from "postgres";

import {
  bootstrapOperator,
  createSqlOptions,
  deleteOperatorPasskeys,
  grantOperatorManagement,
  resolveDatabaseUrl,
} from "@animal-helper/event-store";

import { loadAdminConfig } from "./config.js";

const emailIndex = process.argv.indexOf("--email");
const email = emailIndex >= 0 ? process.argv[emailIndex + 1] : undefined;
const openFile = process.argv.includes("--open");
const resetPasskeys = process.argv.includes("--reset-passkeys");
const grantManagement = process.argv.includes("--grant-management");

if (email === undefined || email.length === 0) {
  console.error(
    "Usage: pnpm admin:bootstrap -- --email operator@example.com [--open] [--reset-passkeys] [--grant-management]",
  );
  process.exitCode = 2;
} else {
  const config = loadAdminConfig(process.env);
  if (config === undefined) {
    throw new Error("ADMIN_ORIGIN is required to bootstrap an operator.");
  }

  const sql = postgres(resolveDatabaseUrl(process.env), {
    ...createSqlOptions(process.env, { max: 1 }),
    prepare: false,
  });
  try {
    if (grantManagement) {
      if (resetPasskeys || openFile)
        throw new Error(
          "--grant-management cannot be combined with --open or --reset-passkeys.",
        );
      await grantOperatorManagement(sql, email);
      console.log(
        "Account-management permission granted to the enrolled operator.",
      );
    } else {
      if (resetPasskeys) {
        const removed = await deleteOperatorPasskeys(sql, email);
        console.log(
          `Removed ${String(removed)} stored passkey(s) for that operator.`,
        );
      }
      const token = await bootstrapOperator(sql, email);
      const url = new URL(config.origin);
      url.hash = `bootstrap=${token}`;
      const directory = await mkdtemp(
        path.join(tmpdir(), "ah-operator-setup-"),
      );
      const filename = path.join(directory, "setup.html");
      const href = url.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
      await writeFile(
        filename,
        `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Animal Helper operator setup</title><h1>Set up your operator passkey</h1><p>This private link expires in 15 minutes. Delete this file after setup.</p><a href="${href}">Open operator setup</a>\n`,
        { mode: 0o600, flag: "wx" },
      );
      console.log(
        `Private operator setup file (expires in 15 minutes): ${filename}`,
      );
      if (openFile && process.platform === "darwin") {
        spawn("open", [filename], { stdio: "ignore" }).unref();
      }
    }
  } finally {
    await sql.end();
  }
}
