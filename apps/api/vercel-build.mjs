import { spawn } from "node:child_process";

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? "unknown"}.`));
    });
  });

await run("pnpm", ["--filter", "@animal-helper/backoffice", "build"]);
await run("rm", ["-rf", "static"]);
await run("mkdir", ["-p", "static", "dist"]);
await run("cp", ["-R", "../backoffice/dist/.", "static/"]);
await run("pnpm", [
  "exec",
  "esbuild",
  "src/vercel-entry.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node24",
  "--outfile=dist/vercel-entry.mjs",
  "--external:postgres",
  "--external:@simplewebauthn/server",
]);

// Production secrets stay in Vercel. Apply additive migrations after the build
// succeeds and before the deployment can receive production traffic.
if (process.env.VERCEL_ENV === "production") {
  if (
    process.env.DATABASE_ENVIRONMENT !== "production" ||
    process.env.DATABASE_SSL_MODE !== "verify" ||
    !process.env.DATABASE_MIGRATION_URL
  ) {
    throw new Error(
      "Production migrations require a direct URL and verified TLS.",
    );
  }
  await run("pnpm", ["--workspace-root", "db:migrate"]);
}
