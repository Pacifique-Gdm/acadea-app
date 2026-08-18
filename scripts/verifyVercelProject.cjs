const { existsSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const EXPECTED_TEAM_ID = "team_0HPpoCuBLghGGzAB7f5kSVeA";
const TARGETS = {
  staging: { projectName: "acadea-staging", projectId: "prj_Jeomz31fGTu5xZ3AVqOYYWc5AFy4" },
  production: { projectName: "acadea-app", projectId: "prj_XOlCG83UoKgWF4EbjGBtQKSNfNQ3" },
};

function readProject(cwd = process.cwd()) {
  const file = join(cwd, ".vercel", "project.json");
  if (!existsSync(file)) throw new Error(`Vercel project link missing: ${file}`);
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error(`Vercel project link is invalid: ${file}`); }
}

function verifyVercelProject({ target, cwd = process.cwd(), project } = {}) {
  const expected = TARGETS[target];
  if (!expected) throw new Error(`Unknown Vercel target: ${target}`);
  const actual = project || readProject(cwd);
  if (actual.projectName !== expected.projectName || actual.projectId !== expected.projectId || actual.orgId !== EXPECTED_TEAM_ID) {
    throw new Error(`Vercel target mismatch: expected ${expected.projectName}/${expected.projectId}/${EXPECTED_TEAM_ID}.`);
  }
  return { target, ...expected, orgId: EXPECTED_TEAM_ID };
}

if (require.main === module) {
  const target = process.argv[2] || process.env.VITE_APP_ENV || "";
  try { console.log(`Vercel target OK (${verifyVercelProject({ target }).projectName}).`); }
  catch (error) { console.error(error instanceof Error ? error.message : "Vercel target verification failed."); process.exit(1); }
}

module.exports = { EXPECTED_TEAM_ID, TARGETS, readProject, verifyVercelProject };
