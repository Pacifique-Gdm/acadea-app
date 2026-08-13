const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const REQUIRED_BRANCH = "main";
const PROOF_FILE = ".vercel-production-source.json";
const MAX_PROOF_AGE_MS = 2 * 60 * 60 * 1000;

function gitValue(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function localGitState(cwd) {
  const branch = gitValue(cwd, ["branch", "--show-current"]);
  const head = gitValue(cwd, ["rev-parse", "HEAD"]);
  const originMain = gitValue(cwd, ["rev-parse", "origin/main"]);
  if (!branch || !head || !originMain) return null;
  return { branch, head, originMain, clean: gitValue(cwd, ["status", "--porcelain"]) === "" };
}

function assertTrustedMain(state, source, { requireClean = false } = {}) {
  if (state.branch !== REQUIRED_BRANCH) throw new Error(`Production deployment blocked: ${source} branch "${state.branch}" is not "${REQUIRED_BRANCH}".`);
  if (state.head && state.originMain && state.head !== state.originMain) throw new Error(`Production deployment blocked: ${source} HEAD does not match origin/main.`);
  if (requireClean && !state.clean) throw new Error(`Production deployment blocked: ${source} working tree is not clean.`);
}

function readCliProof(cwd, now = Date.now()) {
  const path = join(cwd, PROOF_FILE);
  if (!existsSync(path)) return null;
  try {
    const proof = JSON.parse(readFileSync(path, "utf8"));
    const generatedAt = Date.parse(proof.generatedAt);
    const validSha = typeof proof.head === "string" && /^[a-f0-9]{40}$/i.test(proof.head);
    if (proof.version !== 1 || proof.target !== "production" || proof.branch !== REQUIRED_BRANCH || !validSha || proof.head !== proof.originMain || !Number.isFinite(generatedAt) || generatedAt > now || now - generatedAt > MAX_PROOF_AGE_MS) return null;
    return proof;
  } catch {
    return null;
  }
}

function verifyProductionSource({ cwd = process.cwd(), env = process.env, target = env.VERCEL_ENV || process.argv[2] || "", now = Date.now() } = {}) {
  if (target !== "production") return { source: "non-production", branch: "" };

  const vercelBranch = env.VERCEL === "1" ? (env.VERCEL_GIT_COMMIT_REF || "").trim() : "";
  if (vercelBranch) {
    assertTrustedMain({ branch: vercelBranch }, "Vercel Git");
    return { source: "vercel-git", branch: vercelBranch, sha: env.VERCEL_GIT_COMMIT_SHA || "" };
  }

  const local = localGitState(cwd);
  if (local) {
    assertTrustedMain(local, "local Git");
    return { source: "local-git", branch: local.branch, sha: local.head };
  }

  if (env.VERCEL === "1") {
    const proof = readCliProof(cwd, now);
    if (proof) return { source: "vercel-cli-proof", branch: proof.branch, sha: proof.head };
  }

  throw new Error("Production deployment blocked: no trustworthy Git branch information or valid Vercel CLI deployment proof is available.");
}

if (require.main === module) {
  try {
    const result = verifyProductionSource();
    console.log(`Deployment branch check OK (${result.source} / ${result.branch || "not-applicable"}${result.sha ? ` / ${result.sha.slice(0, 7)}` : ""}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production deployment blocked.");
    process.exit(1);
  }
}

module.exports = { MAX_PROOF_AGE_MS, PROOF_FILE, assertTrustedMain, localGitState, readCliProof, verifyProductionSource };
