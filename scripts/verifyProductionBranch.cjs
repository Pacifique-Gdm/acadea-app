const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_REF_NAME || "";
const target = process.env.VERCEL_ENV || "";

if (target === "production" && branch !== "main") {
  console.error(`Production deployment blocked: branch "${branch}" is not "main".`);
  process.exit(1);
}

console.log(`Deployment branch check OK (${target || "local"} / ${branch || "unknown"}).`);
