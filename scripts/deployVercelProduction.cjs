const { execFileSync, spawnSync } = require("node:child_process");
const { rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { PROOF_FILE, assertTrustedMain, localGitState } = require("./verifyProductionBranch.cjs");

const cwd = process.cwd();
const state = localGitState(cwd);
if (!state) {
  console.error("Production deployment blocked: local Git metadata is unavailable.");
  process.exit(1);
}

try {
  assertTrustedMain(state, "local pre-deployment", { requireClean: true });
  execFileSync("git", ["diff", "--check"], { cwd, stdio: "inherit" });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production pre-deployment verification failed.");
  process.exit(1);
}

const proofPath = join(cwd, PROOF_FILE);
writeFileSync(proofPath, `${JSON.stringify({ version: 1, target: "production", branch: state.branch, head: state.head, originMain: state.originMain, generatedAt: new Date().toISOString() })}\n`, { flag: "wx" });

try {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, ["vercel", "deploy", "--prod"], { cwd, stdio: "inherit", env: process.env });
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(proofPath, { force: true });
}
