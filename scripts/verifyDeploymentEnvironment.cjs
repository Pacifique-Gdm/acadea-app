const target = process.env.VERCEL_ENV || process.env.VITE_APP_ENV || "development";
const projectId = process.env.VITE_FIREBASE_PROJECT_ID || "";
const expectedProductionProjectId = process.env.ACADEA_EXPECTED_PRODUCTION_FIREBASE_PROJECT_ID || "";
const expectedPreviewProjectId = process.env.ACADEA_EXPECTED_PREVIEW_FIREBASE_PROJECT_ID || "";

const productionLike = target === "production";
const previewLike = target === "preview" || target === "staging";
const nonProductionProjectPattern = /staging|preview|test|demo|dev/i;
const productionProjectPattern = /prod|production/i;

function fail(message) {
  console.error(message);
  process.exit(1);
}

if ((productionLike || previewLike) && !projectId) {
  fail(`Deployment environment check failed: VITE_FIREBASE_PROJECT_ID is required for "${target}".`);
}

if (productionLike && nonProductionProjectPattern.test(projectId)) {
  fail(`Production deployment blocked: Firebase project "${projectId}" looks like a non-production database.`);
}

if (previewLike && productionProjectPattern.test(projectId)) {
  fail(`Preview deployment blocked: Firebase project "${projectId}" looks like a production database.`);
}

if (productionLike && expectedProductionProjectId && projectId !== expectedProductionProjectId) {
  fail(`Production deployment blocked: expected Firebase project "${expectedProductionProjectId}", received "${projectId}".`);
}

if (previewLike && expectedPreviewProjectId && projectId !== expectedPreviewProjectId) {
  fail(`Preview deployment blocked: expected Firebase project "${expectedPreviewProjectId}", received "${projectId}".`);
}

console.log(`Deployment environment check OK (${target} / ${projectId || "no-firebase-local"}).`);
