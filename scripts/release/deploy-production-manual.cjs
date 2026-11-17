// Mise en ligne MANUELLE de la production (constructions automatiques Vercel coupées).
// Usage : node scripts/release/deploy-production-manual.cjs --cwd=<dossier de déploiement à jour sur origin/main> (appelé par ship-lot.sh)
// Étapes :
//  1. mêmes garde-fous que scripts/deployVercelProduction.cjs (branche main, HEAD = origin/main,
//     dossier propre, projet Vercel acadea-app, git diff --check) ;
//  2. preuve de source (.vercel-production-source.json) envoyée avec le code, lue par la construction ;
//  3. construction de production SANS attribution du domaine (--skip-domain), en inscrivant le SHA
//     de main dans la version (VERCEL_GIT_COMMIT_SHA) ;
//  4. affiche l'adresse de la construction : les vérifications puis `vercel promote` se font ensuite.
// Aucun fichier .env n'est lu ni envoyé (.vercelignore exclut .env* et service-account*.json).
const { execFileSync, spawnSync } = require("node:child_process");
const { rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const cwdArg = process.argv.find((arg) => arg.startsWith("--cwd="));
if (!cwdArg) throw new Error("Indiquez --cwd=<dossier de déploiement>.");
const cwd = cwdArg.slice(6);
const { PROOF_FILE, assertTrustedMain, localGitState } = require(join(cwd, "scripts/verifyProductionBranch.cjs"));
const { verifyVercelProject } = require(join(cwd, "scripts/verifyVercelProject.cjs"));

const state = localGitState(cwd);
if (!state) throw new Error("Informations Git indisponibles.");
verifyVercelProject({ target: "production", cwd });
assertTrustedMain(state, "dossier de déploiement", { requireClean: true });
execFileSync("git", ["diff", "--check"], { cwd, stdio: "inherit" });

const proofPath = join(cwd, PROOF_FILE);
writeFileSync(proofPath, `${JSON.stringify({ version: 1, target: "production", branch: state.branch, head: state.head, originMain: state.originMain, generatedAt: new Date().toISOString() })}\n`, { flag: "wx" });
try {
  const vercel = process.platform === "win32" ? "vercel.cmd" : "vercel";
  const result = spawnSync(vercel, ["deploy", "--prod", "--skip-domain", "--yes", "--scope", "pacifique-gdms-projects", "--build-env", `VERCEL_GIT_COMMIT_SHA=${state.head}`], { cwd, encoding: "utf8", shell: process.platform === "win32" });
  process.stderr.write(result.stderr ?? "");
  const url = `${result.stdout ?? ""} ${result.stderr ?? ""}`.trim().split(/\s+/).find((part) => /^https:\/\/acadea-[a-z0-9]+-pacifique-gdms-projects\.vercel\.app$/.test(part));
  console.log(JSON.stringify({ status: result.status, sha: state.head, url: url ?? null }));
  process.exitCode = result.status === 0 && url ? 0 : 1;
} finally {
  rmSync(proofPath, { force: true });
}
