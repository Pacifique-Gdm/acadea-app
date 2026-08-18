const { execFileSync } = require("node:child_process");

function changedFiles({ cwd = process.cwd(), from = "" } = {}) {
  const args = ["diff", "--name-only"];
  if (from) args.push(from);
  try { return execFileSync("git", args, { cwd, encoding: "utf8" }).split(/\r?\n/).filter(Boolean); }
  catch { return []; }
}

function deploymentPlan(files) {
  const has = (prefixes) => files.some((file) => prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
  return {
    vercel: has(["src", "api", "public", "index.html", "package.json", "package-lock.json", "vite.config.ts", "vercel.json", "scripts"]),
    functions: has(["functions"]),
    firestoreRules: files.includes("firestore.rules"),
    storageRules: files.includes("storage.rules"),
    indexes: files.includes("firestore.indexes.json"),
  };
}

if (require.main === module) {
  const fromArg = process.argv.indexOf("--from");
  const from = fromArg >= 0 ? process.argv[fromArg + 1] : "";
  const plan = deploymentPlan(changedFiles({ from }));
  for (const [key, value] of Object.entries(plan)) console.log(`${key}: ${value ? "YES" : "NO"}`);
}

module.exports = { changedFiles, deploymentPlan };
