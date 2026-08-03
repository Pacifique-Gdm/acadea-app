const { spawnSync } = require("node:child_process");

const target = process.env.VITE_APP_ENV;
if (!target || !["staging", "production"].includes(target)) {
  console.error("Build Vercel refusé : VITE_APP_ENV doit être explicitement défini à staging ou production.");
  process.exit(1);
}

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const serverCheck = spawnSync(process.execPath, ["scripts/verifyVercelServerEnvironment.cjs"], { stdio: "inherit", env: process.env });
if (serverCheck.status !== 0) process.exit(serverCheck.status ?? 1);
const result = spawnSync(command, ["run", `build:${target}`], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
