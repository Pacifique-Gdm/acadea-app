const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || "";
const vercelTarget = process.env.VERCEL_ENV || "";
const target = process.env.VITE_APP_ENV || vercelTarget;
const expectedProductionBranch =
  target === "staging" ? "staging" : vercelTarget === "production" ? "main" : "";

if (vercelTarget === "production" && expectedProductionBranch && branch !== expectedProductionBranch) {
  console.error(`${target === "staging" ? "Staging" : "Production"} deployment blocked: branch "${branch}" is not "${expectedProductionBranch}".`);
  process.exit(1);
}

console.log(`Deployment branch check OK (${target || "local"} / ${branch || "unknown"}).`);
