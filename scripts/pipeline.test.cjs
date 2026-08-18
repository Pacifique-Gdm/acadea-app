const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveNpmCommand, runVercelBuild } = require("./buildVercelEnvironment.cjs");
const { verifyVercelProject } = require("./verifyVercelProject.cjs");
const { deploymentPlan } = require("./deploymentPlan.cjs");
const { verifyProductionSource } = require("./verifyProductionBranch.cjs");

test("resolves npm command per platform", () => {
  assert.equal(resolveNpmCommand("win32"), "npm.cmd");
  assert.equal(resolveNpmCommand("linux"), "npm");
});

test("build runner propagates environment and uses portable Windows shell", () => {
  const calls = [];
  const spawn = (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; };
  assert.equal(runVercelBuild({ platform: "win32", env: { VITE_APP_ENV: "staging" }, spawn }), 0);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[1].command, "npm.cmd");
  assert.equal(calls[1].options.shell, true);
  assert.equal(calls[1].options.env.VITE_APP_ENV, "staging");
});

test("build runner uses npm on Linux", () => {
  const calls = [];
  const spawn = (command, args) => { calls.push({ command, args }); return { status: 0 }; };
  assert.equal(runVercelBuild({ platform: "linux", env: { VITE_APP_ENV: "production" }, spawn }), 0);
  assert.equal(calls[1].command, "npm");
});

test("invalid build target is rejected", () => {
  assert.equal(runVercelBuild({ env: {}, spawn: () => ({ status: 0 }) }), 1);
});

test("Vercel links are exact and missing links fail closed", () => {
  assert.equal(verifyVercelProject({ target: "staging", project: { projectName: "acadea-staging", projectId: "prj_Jeomz31fGTu5xZ3AVqOYYWc5AFy4", orgId: "team_0HPpoCuBLghGGzAB7f5kSVeA" } }).projectName, "acadea-staging");
  assert.throws(() => verifyVercelProject({ target: "production", project: { projectName: "acadea-staging", projectId: "wrong", orgId: "wrong" } }));
  assert.throws(() => verifyVercelProject({ target: "staging", cwd: "C:/path/without/.vercel" }));
});

test("deployment plan scopes resources to changed files", () => {
  assert.deepEqual(deploymentPlan(["src/App.tsx", "functions/src/index.ts"]), { vercel: true, functions: true, firestoreRules: false, storageRules: false, indexes: false });
  assert.deepEqual(deploymentPlan(["firestore.rules", "storage.rules", "firestore.indexes.json"]), { vercel: false, functions: false, firestoreRules: true, storageRules: true, indexes: true });
});

test("production branch guard accepts main from Vercel Git and rejects feature branches", () => {
  assert.equal(verifyProductionSource({ target: "production", env: { VERCEL: "1", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) } }).branch, "main");
  assert.throws(() => verifyProductionSource({ target: "production", env: { VERCEL: "1", VERCEL_GIT_COMMIT_REF: "feature/test" } }), /not "main"/);
});

test("production branch guard fails closed without branch evidence", () => {
  assert.throws(() => verifyProductionSource({ target: "production", cwd: "C:/path/without/.git", env: { VERCEL: "1" } }), /no trustworthy Git branch information/);
});
