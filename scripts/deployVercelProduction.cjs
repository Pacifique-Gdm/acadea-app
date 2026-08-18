const { execFileSync, spawnSync } = require("node:child_process");
const { rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { PROOF_FILE, assertTrustedMain, localGitState } = require("./verifyProductionBranch.cjs");
const { verifyVercelProject } = require("./verifyVercelProject.cjs");

const cwd = process.cwd();
const state = localGitState(cwd);
if (!state) {
  console.error("Production deployment blocked: local Git metadata is unavailable.");
  process.exit(1);
}

try {
  verifyVercelProject({ target: "production", cwd });
  assertTrustedMain(state, "local pre-deployment", { requireClean: true });
  execFileSync("git", ["diff", "--check"], { cwd, stdio: "inherit" });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Production pre-deployment verification failed.");
  process.exit(1);
}

const proofPath = join(cwd, PROOF_FILE);
writeFileSync(proofPath, `${JSON.stringify({ version: 1, target: "production", branch: state.branch, head: state.head, originMain: state.originMain, generatedAt: new Date().toISOString() })}\n`, { flag: "wx" });

try {
  const runVercel = (args) => process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npx.cmd vercel ${args.join(" ")}`], { cwd, stdio: "inherit", env: process.env })
    : spawnSync("npx", ["vercel", ...args], { cwd, stdio: "inherit", env: process.env });
  let failed = false;
  for (const args of [["pull", "--yes", "--environment=production"], ["build", "--prod"], ["deploy", "--prebuilt", "--prod"]]) {
    const result = runVercel(args);
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) { failed = true; process.exitCode = result.status ?? 1; break; }
  }
  if (!failed) process.exitCode = 0;
} finally {
  rmSync(proofPath, { force: true });
}
