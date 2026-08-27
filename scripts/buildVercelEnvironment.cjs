const { spawnSync } = require("node:child_process");
const { readCliProof } = require("./verifyProductionBranch.cjs");

function resolveNpmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function runChild(command, args, { env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  return spawn(command, args, {
    stdio: "inherit",
    env,
    cwd: process.cwd(),
    // Invoke npm.cmd directly. A shell-backed invocation requires cmd.exe,
    // which is unavailable in some Vercel CLI Windows builders.
    shell: false,
  });
}

function buildEnvironment(env = process.env, cwd = process.cwd()) {
  const resolved = { ...env };
  if (resolved.VITE_APP_ENV !== "production" || resolved.VERCEL_GIT_COMMIT_SHA?.trim()) return resolved;

  const proof = readCliProof(cwd);
  if (proof) {
    resolved.VERCEL_GIT_COMMIT_REF = proof.branch;
    resolved.VERCEL_GIT_COMMIT_SHA = proof.head;
  }
  return resolved;
}

function runVercelBuild({ env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  const target = env.VITE_APP_ENV;
  if (!target || !["staging", "production"].includes(target)) {
    console.error("Build Vercel refusé : VITE_APP_ENV doit être explicitement défini à staging ou production.");
    return 1;
  }
  const resolvedEnvironment = buildEnvironment(env);
  const serverCheck = runChild(process.execPath, ["scripts/verifyVercelServerEnvironment.cjs"], { env: resolvedEnvironment, platform, spawn });
  if (serverCheck.error || serverCheck.status !== 0) return serverCheck.error ? 1 : (serverCheck.status ?? 1);
  const result = runChild(resolveNpmCommand(platform), ["run", `build:${resolvedEnvironment.VITE_APP_ENV}`], { env: resolvedEnvironment, platform, spawn });
  return result.error ? 1 : (result.status ?? 1);
}

if (require.main === module) process.exit(runVercelBuild());

module.exports = { buildEnvironment, resolveNpmCommand, runChild, runVercelBuild };
