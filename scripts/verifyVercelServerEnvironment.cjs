const expectedProjects = {
  staging: "acadea-staging",
  production: "acadea-production",
};

function fail(message) {
  console.error(`Vercel server environment check failed: ${message}`);
  process.exit(1);
}

if (!process.env.VERCEL) {
  process.exit(0);
}

const target = process.env.VITE_APP_ENV;
if (!target || !Object.hasOwn(expectedProjects, target)) {
  fail("VITE_APP_ENV must explicitly target staging or production.");
}

const expectedProjectId = expectedProjects[target];
if (process.env.VITE_FIREBASE_PROJECT_ID !== expectedProjectId) {
  fail(`frontend project must be ${expectedProjectId}.`);
}

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!rawServiceAccount) {
  fail("FIREBASE_SERVICE_ACCOUNT_JSON is required by the provisioning APIs.");
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(rawServiceAccount);
} catch {
  fail("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.");
}

if (serviceAccount?.project_id !== expectedProjectId) {
  fail(`Firebase Admin project must be ${expectedProjectId}.`);
}

console.log(`Vercel server environment check OK (${target} / ${expectedProjectId}).`);
