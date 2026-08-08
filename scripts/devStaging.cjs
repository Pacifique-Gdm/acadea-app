const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("dotenv");

const readEnvFile = (filename) => {
  const path = resolve(process.cwd(), filename);
  return existsSync(path) ? parse(readFileSync(path)) : {};
};

const stagingEnv = readEnvFile(".env.staging");
const stagingLocalEnv = readEnvFile(".env.staging.local");
const developerLocalEnv = readEnvFile(".env.local");
const environment = {
  ...process.env,
  ...stagingEnv,
  ...stagingLocalEnv,
  VITE_APP_ENV: "staging",
};

if (developerLocalEnv.VERCEL_OIDC_TOKEN && !environment.VERCEL_OIDC_TOKEN) {
  environment.VERCEL_OIDC_TOKEN = developerLocalEnv.VERCEL_OIDC_TOKEN;
}

if (environment.VITE_FIREBASE_PROJECT_ID !== "acadea-staging") {
  console.error("Démarrage local refusé : la configuration Firebase doit cibler acadea-staging.");
  process.exit(1);
}

if (!environment.FIREBASE_SERVICE_ACCOUNT_JSON) {
  console.error("Demarrage local refuse : FIREBASE_SERVICE_ACCOUNT_JSON Staging est obligatoire.");
  process.exit(1);
}

if (environment.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(environment.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.project_id !== "acadea-staging") {
      console.error("Démarrage local refusé : Firebase Admin ne cible pas acadea-staging.");
      process.exit(1);
    }
  } catch {
    console.error("Démarrage local refusé : FIREBASE_SERVICE_ACCOUNT_JSON Staging est invalide.");
    process.exit(1);
  }
}

const vercelCli = resolve(process.cwd(), "node_modules", "vercel", "dist", "vc.js");
const result = spawnSync(process.execPath, [vercelCli, "dev", "--listen", "127.0.0.1:5173"], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  console.error("Impossible de démarrer Vercel Dev.", result.error.message);
}
process.exit(result.status ?? 1);
