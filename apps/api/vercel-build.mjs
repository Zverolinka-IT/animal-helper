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
await run("mkdir", ["-p", "static", "api"]);
await run("cp", ["-R", "../backoffice/dist/.", "static/"]);
await run("pnpm", [
  "exec",
  "esbuild",
  "src/vercel-entry.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node24",
  "--outfile=api/index.mjs",
  "--external:postgres",
  "--external:@simplewebauthn/server",
]);
