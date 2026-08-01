const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const requestedTarget = process.argv[2] || process.env.VITE_APP_ENV || process.env.VERCEL_ENV || "staging";
const target = requestedTarget === "production" ? "production" : "staging";
const modeFile = path.resolve(process.cwd(), `.env.${target}`);
const localFile = path.resolve(process.cwd(), ".env.local");
const parseFile = (file) => fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
const effectiveEnv = { ...parseFile(localFile), ...parseFile(modeFile), ...process.env, VITE_APP_ENV: target };
const projectId = effectiveEnv.VITE_FIREBASE_PROJECT_ID || "";
const expectedProductionProjectId = "acadea-production";
const expectedPreviewProjectId = "acadea-staging";
const requiredFirebaseEnv = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

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

if (productionLike || previewLike) {
  const missingFirebaseEnv = requiredFirebaseEnv.filter((name) => !effectiveEnv[name]);
  if (missingFirebaseEnv.length > 0) {
    fail(`Deployment environment check failed: missing Firebase variables for "${target}": ${missingFirebaseEnv.join(", ")}.`);
  }
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
