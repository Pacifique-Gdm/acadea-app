const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("dotenv");

const EXPECTED_STAGING_PROJECT_ID = "acadea-staging";
const LOCAL_SERVER_ENV_PREFIXES = ["VITE_", "ACADEA_"];
const LOCAL_SERVER_ENV_NAMES = new Set(["FIREBASE_SERVICE_ACCOUNT_JSON", "VERCEL_OIDC_TOKEN"]);

const readEnvFile = (filename) => {
  const path = resolve(process.cwd(), filename);
  return existsSync(path) ? parse(readFileSync(path)) : {};
};

const selectLocalServerEnvironment = (values) => Object.fromEntries(
  Object.entries(values).filter(([name]) => (
    LOCAL_SERVER_ENV_NAMES.has(name)
    || LOCAL_SERVER_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
  )),
);

const mergeStagingEnvironment = ({
  baseEnv = {},
  stagingEnv = {},
  localEnv = {},
  stagingLocalEnv = {},
  processEnvironment = {},
}) => ({
  ...selectLocalServerEnvironment(baseEnv),
  ...selectLocalServerEnvironment(stagingEnv),
  ...selectLocalServerEnvironment(localEnv),
  ...selectLocalServerEnvironment(stagingLocalEnv),
  ...processEnvironment,
  VITE_APP_ENV: "staging",
});

const loadStagingEnvironment = () => mergeStagingEnvironment({
  baseEnv: readEnvFile(".env"),
  stagingEnv: readEnvFile(".env.staging"),
  localEnv: readEnvFile(".env.local"),
  stagingLocalEnv: readEnvFile(".env.staging.local"),
  processEnvironment: process.env,
});

const validateStagingEnvironment = (environment) => {
  if (environment.VITE_FIREBASE_PROJECT_ID !== EXPECTED_STAGING_PROJECT_ID) {
    throw new Error("Démarrage local refusé : la configuration Firebase doit cibler acadea-staging.");
  }

  const rawCredential = environment.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!rawCredential?.trim()) {
    throw new Error("Credential Firebase Admin Staging introuvable. Ajoutez-le dans .env.staging.local.");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(rawCredential);
  } catch {
    throw new Error("Credential Firebase Admin Staging invalide.");
  }

  if (serviceAccount?.project_id !== EXPECTED_STAGING_PROJECT_ID) {
    throw new Error("Credential refusé : projet Firebase inattendu.");
  }
};

const start = () => {
  const environment = loadStagingEnvironment();
  try {
    validateStagingEnvironment(environment);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Démarrage local Staging refusé.");
    process.exit(1);
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
};

module.exports = {
  EXPECTED_STAGING_PROJECT_ID,
  loadStagingEnvironment,
  mergeStagingEnvironment,
  selectLocalServerEnvironment,
  validateStagingEnvironment,
};

if (require.main === module) start();
