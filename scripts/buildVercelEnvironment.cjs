const { spawnSync } = require("node:child_process");

function resolveNpmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function runChild(command, args, { env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  return spawn(command, args, {
    stdio: "inherit",
    env,
    cwd: process.cwd(),
    // npm.cmd is a shell command on Windows. Using the shell avoids the
    // EINVAL produced by spawnSync in restricted Windows environments while
    // keeping direct execution on Linux/Vercel.
    shell: platform === "win32" && command === resolveNpmCommand(platform),
  });
}

function runVercelBuild({ env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  const target = env.VITE_APP_ENV;
  if (!target || !["staging", "production"].includes(target)) {
    console.error("Build Vercel refusé : VITE_APP_ENV doit être explicitement défini à staging ou production.");
    return 1;
  }
  const serverCheck = runChild(process.execPath, ["scripts/verifyVercelServerEnvironment.cjs"], { env, platform, spawn });
  if (serverCheck.error || serverCheck.status !== 0) return serverCheck.error ? 1 : (serverCheck.status ?? 1);
  const result = runChild(resolveNpmCommand(platform), ["run", `build:${env.VITE_APP_ENV}`], { env, platform, spawn });
  return result.error ? 1 : (result.status ?? 1);
}

if (require.main === module) process.exit(runVercelBuild());

module.exports = { resolveNpmCommand, runChild, runVercelBuild };
