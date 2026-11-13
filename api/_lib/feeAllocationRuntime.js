import { createHash } from "node:crypto";
import { FeeAllocationError } from "./feeAllocationMath.js";

export const allocationHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const allocationStateId = (school, year, currency) => allocationHash([school, year, currency]);
export const allocationBalanceId = (school, year, currency, rubric) => allocationHash([school, year, currency, rubric]);
export const allocationFail = (message, code = "allocation-reconciliation-required", status = 409) => {
  throw new FeeAllocationError(status, code, message);
};
export const allocationIdentifier = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export const allocationMinor = value => Number.isSafeInteger(value) && value >= 0;

// This candidate deliberately cannot activate a production project. On hosted
// Staging, an Admin-SDK-only, expiring registration is required in addition to
// the school fixture marker. A role, claim or environment variable is not enough.
export function allocationTestProject(db, env = process.env) {
  if (db.projectId === "acadea-staging") return !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST;
  return db.projectId === "demo-acadea" && env.ACADEA_E2E_LOCAL_EMULATORS === "YES"
    && env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8080" && env.FIREBASE_AUTH_EMULATOR_HOST === "127.0.0.1:9099"
    && !env.VERCEL && !env.GOOGLE_APPLICATION_CREDENTIALS && !env.FIREBASE_SERVICE_ACCOUNT_JSON;
}

export async function readAllocationTestScope(db, reader, schoolId, now) {
  if (!allocationTestProject(db)) return null;
  const get = ref => reader ? reader.get(ref) : ref.get();
  const school = (await get(db.doc(`schools/${schoolId}`))).data();
  if (!school?.fixtureId || !/^e2e-allocation-[a-f0-9]{16,64}$/.test(school.fixtureId)) return null;
  const scope = (await get(db.doc(`feeAllocationTestScopes/${school.fixtureId}`))).data();
  if (!scope || scope.status !== "active" || scope.projectId !== db.projectId || scope.fixtureId !== school.fixtureId
    || !Array.isArray(scope.schoolIds) || !scope.schoolIds.includes(schoolId)
    || !Number.isFinite(Date.parse(scope.expiresAt)) || Date.parse(scope.expiresAt) <= Date.parse(now)
    || !Number.isFinite(Date.parse(scope.createdAt)) || Date.parse(scope.createdAt) > Date.parse(now)
    || Date.parse(scope.expiresAt) - Date.parse(scope.createdAt) > 24 * 60 * 60 * 1000
    || school.status !== "active") allocationFail("Périmètre de recette absent, expiré ou neutralisé.", "test-scope-required", 403);
  return { school, scope };
}

export async function readOperationalAllocation({ db, transaction, schoolId, schoolYearId, currency, now }) {
  if (!allocationTestProject(db)) return null;
  const get = ref => transaction ? transaction.get(ref) : ref.get();
  const state = (await get(db.doc(`feeAllocationStates/${allocationStateId(schoolId, schoolYearId, currency)}`))).data();
  if (!state || !["ACTIVE", "PAUSED"].includes(state.status)) return null;
  const test = await readAllocationTestScope(db, transaction, schoolId, now);
  if (!test || state.fixtureId !== test.school.fixtureId || state.schoolId !== schoolId || state.schoolYearId !== schoolYearId
    || state.currency !== currency || !state.openingId || !Number.isFinite(Date.parse(state.cutoffAt)) || Date.parse(state.cutoffAt) > Date.parse(now)
    || !Array.isArray(state.rubrics) || state.rubrics.length < 1 || state.rubrics.length > 40) allocationFail("État actif non rapproché ou hors périmètre.");
  return { ...state, testOnly: true };
}
