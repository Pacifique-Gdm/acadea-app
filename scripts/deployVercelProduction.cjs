const { execFileSync, spawnSync } = require("node:child_process");
const { rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { PROOF_FILE, assertTrustedMain, localGitState } = require("./verifyProductionBranch.cjs");
const { verifyVercelProject } = require("./verifyVercelProject.cjs");

function resolveNpxCommand(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

function resolveVercelInvocation(cwd = process.cwd(), platform = process.platform) {
  try {
    return { command: process.execPath, argsPrefix: [require.resolve("vercel/dist/vc.js", { paths: [cwd] })] };
  } catch {
    return { command: resolveNpxCommand(platform), argsPrefix: ["vercel"] };
  }
}

function deployProduction({ cwd = process.cwd(), env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  const state = localGitState(cwd);
  if (!state) throw new Error("Production deployment blocked: local Git metadata is unavailable.");
  verifyVercelProject({ target: "production", cwd });
  assertTrustedMain(state, "local pre-deployment", { requireClean: true });
  execFileSync("git", ["diff", "--check"], { cwd, stdio: "inherit" });

  const proofPath = join(cwd, PROOF_FILE);
  writeFileSync(proofPath, `${JSON.stringify({ version: 1, target: "production", branch: state.branch, head: state.head, originMain: state.originMain, generatedAt: new Date().toISOString() })}\n`, { flag: "wx" });
  try {
    const invocation = resolveVercelInvocation(cwd, platform);
    const runVercel = (args) => spawn(invocation.command, [...invocation.argsPrefix, ...args], {
      cwd,
      stdio: "inherit",
      env,
      shell: false,
    });
    for (const args of [["pull", "--yes", "--environment=production"], ["build", "--prod"], ["deploy", "--prebuilt", "--prod"]]) {
      const result = runVercel(args);
      if (result.error) throw result.error;
      if ((result.status ?? 1) !== 0) return result.status ?? 1;
    }
    return 0;
  } finally {
    rmSync(proofPath, { force: true });
  }
}

if (require.main === module) {
  try {
    process.exitCode = deployProduction();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production deployment failed.");
    process.exitCode = 1;
  }
}

module.exports = { deployProduction, resolveNpxCommand, resolveVercelInvocation };
