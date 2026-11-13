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

// Extra isolation for fictitious schools only. Ordinary schools use the verified
// school/year/profile and approved reconciliation path below; this registration
// never grants permission to a real school or to a Production fixture.
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

/** A project match is a boundary, never an activation permission. The stored
 * school/year and the administrator's profile are checked independently. */
export function allocationSupportedProject(db) {
  return (["acadea-production", "acadea-staging"].includes(db.projectId)
    && !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST) || allocationTestProject(db);
}

export async function readAllocationEligibility(db, reader, schoolId, now) {
  if (!allocationSupportedProject(db) || !allocationIdentifier(schoolId)) allocationFail("Projet ou établissement non autorisé.", "permission-denied", 403);
  const get = ref => reader ? reader.get(ref) : ref.get();
  const school = (await get(db.doc(`schools/${schoolId}`))).data();
  if (!school || school.active === false || school.status !== "active" || !allocationIdentifier(school.activeSchoolYearId)) {
    allocationFail("Établissement inactif ou année active absente.", "permission-denied", 403);
  }
  const year = (await get(db.doc(`schoolYears/${school.activeSchoolYearId}`))).data();
  const currency = year?.currency ?? school.currency;
  if (!year || year.schoolId !== schoolId || year.status !== "active" || !["USD", "CDF"].includes(currency)
    || (school.currency !== undefined && !["USD", "CDF"].includes(school.currency))) allocationFail("Année active ou devise non vérifiée.");
  if (school.fixtureId) {
    // A fixture can never be promoted to an ordinary Production scope.
    const test = await readAllocationTestScope(db, reader, schoolId, now);
    if (!test) allocationFail("Fixture hors environnement de recette.", "test-scope-required", 403);
    return { school, year, currency, testOnly: true, fixtureId: school.fixtureId };
  }
  return { school, year, currency, testOnly: false, fixtureId: null };
}

export async function readOperationalAllocation({ db, transaction, schoolId, schoolYearId, currency, now }) {
  if (!allocationSupportedProject(db)) return null;
  const get = ref => transaction ? transaction.get(ref) : ref.get();
  const state = (await get(db.doc(`feeAllocationStates/${allocationStateId(schoolId, schoolYearId, currency)}`))).data();
  if (!state || !["ACTIVE", "PAUSED"].includes(state.status)) return null;
  const scope = await readAllocationEligibility(db, transaction, schoolId, now);
  if ((state.fixtureId ?? null) !== scope.fixtureId || state.schoolId !== schoolId || state.schoolYearId !== schoolYearId
    || state.currency !== currency || !state.openingId || !Number.isFinite(Date.parse(state.cutoffAt)) || Date.parse(state.cutoffAt) > Date.parse(now)
    || !Array.isArray(state.rubrics) || state.rubrics.length < 1 || state.rubrics.length > 40) allocationFail("État actif non rapproché ou hors périmètre.");
  const audit = (await get(db.doc(`feeAllocationOpeningAudits/${state.openingId}`))).data();
  if (!audit || audit.status !== "activated" || audit.schoolId !== schoolId || audit.schoolYearId !== schoolYearId || audit.currency !== currency
    || !audit.approvedBy || !audit.activatedAt || audit.configurationFingerprint !== state.configurationFingerprint) allocationFail("Preuve d'activation absente ou incohérente.");
  const receiptVersions = audit.receiptVersions ?? [];
  if (!Array.isArray(receiptVersions) || receiptVersions.some(v => !v || !allocationIdentifier(v.feeTypeId) || !allocationIdentifier(v.versionId))
    || new Set(receiptVersions.map(v => v.feeTypeId)).size !== receiptVersions.length) allocationFail("Versions du rapprochement incohérentes.");
  if (audit.receiptVersionsRunId && !allocationIdentifier(audit.receiptVersionsRunId)) allocationFail('Rapprochement référencé invalide.');
  return { ...state, approvedReceiptVersions: receiptVersions, receiptVersionsRunId: audit.receiptVersionsRunId ?? null, testOnly: scope.testOnly };
}
