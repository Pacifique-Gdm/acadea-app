import { readFeeAllocationScope } from "./feeAllocationPhase1.js";
import { openingInventory } from "./feeAllocationLifecycle.js";
import { readAllocationPages } from "./feeAllocationPagination.js";
import { allocationHash as hash, allocationStateId, allocationFail as fail, readAllocationEligibility, readOperationalAllocation } from "./feeAllocationRuntime.js";
import { validateFeeAllocationRubrics } from "./feeAllocationMath.js";

/** Administrator-only evidence view. No write, no client-supplied school/year. */
export async function readAllocationActivation({ db, caller, body, now = new Date().toISOString() }) {
  if (!["admin", "school_admin"].includes(caller.role)) fail("Rapprochement réservé à l'Administrateur.", "permission-denied", 403);
  if (Object.keys(body).some(k => !["action", "page", "fingerprint"].includes(k))
    || !Number.isSafeInteger(body.page ?? 0) || (body.page ?? 0) < 0) fail("Page de preuve invalide.", "invalid-argument", 400);
  await readFeeAllocationScope(db, caller, caller.schoolId);
  return db.runTransaction(async tx => {
    const scope = await readAllocationEligibility(db, tx, caller.schoolId, now);
    const profile = (await tx.get(db.doc(`users/${caller.uid}`))).data();
    if (!profile || profile.active === false || ["inactive", "disabled", "suspended", "deleting", "deleted"].includes(profile.status)
      || !["admin", "school_admin"].includes(profile.role) || profile.schoolId !== caller.schoolId) fail("Compte non autorisé.", "permission-denied", 403);
    const schoolId = caller.schoolId, yearId = scope.school.activeSchoolYearId, currency = scope.currency;
    const state = (await tx.get(db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`))).data();
    if (["ACTIVE", "PAUSED"].includes(state?.status)) {
      await readOperationalAllocation({ db, transaction: tx, schoolId, schoolYearId: yearId, currency, now });
      return { operational: false, schoolId, schoolYearId: yearId, currency, testOnly: scope.testOnly, status: state.status,
        cutoffAt: state.cutoffAt, rubrics: state.rubrics, versions: [], opening: null, inventory: null };
    }
    const configs = await readAllocationPages(db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId), tx);
    const versions = await readAllocationPages(db.collection("feeAllocationVersions").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId), tx);
    const published = configs.docs.filter(d => d.data().currentVersionId).map(d => {
      const v = versions.docs.find(row => row.id === d.data().currentVersionId)?.data();
      if (!v || v.schoolId !== schoolId || v.schoolYearId !== yearId || v.currency !== currency || v.status !== "published") fail("Version publiée non vérifiée.");
      return v;
    });
    const rubrics = new Map();
    for (const v of published) for (const r of validateFeeAllocationRubrics(v.rubrics, v.feeAmountMinor).rubrics) {
      if (rubrics.has(r.id) && rubrics.get(r.id).name !== r.name) fail("Identité de rubrique incohérente.");
      rubrics.set(r.id, { id: r.id, name: r.name });
    }
    const inventory = await openingInventory(db, tx, schoolId, yearId, currency);
    if (body.fingerprint && body.fingerprint !== inventory.fingerprint) fail("Les pièces ont changé : recommencez leur consultation.");
    const proposal = state?.lastOpeningId ? (await tx.get(db.doc(`feeAllocationOpeningAudits/${state.lastOpeningId}`))).data() : null;
    if (proposal && (proposal.schoolId !== schoolId || proposal.schoolYearId !== yearId || proposal.currency !== currency)) fail("Rapprochement étranger.");
    const stale = proposal && (proposal.fingerprint !== inventory.fingerprint || proposal.configurationFingerprint !== hash(published.map(v => hash(v)).sort()));
    const page = body.page ?? 0;
    return { operational: false, schoolId, schoolYearId: yearId, currency, testOnly: scope.testOnly, status: "EN_PREPARATION", cutoffAt: now,
      rubrics: [...rubrics.values()], versions: versions.docs.map(d => d.data()).filter(v => ["prepared", "published"].includes(v.status))
        .map(v => ({ id: v.id, configId: v.configId, feeTypeId: v.feeTypeId, version: v.version, status: v.status })),
      opening: proposal ? { id: proposal.id, status: proposal.status, stale: !!stale, cutoffAt: proposal.cutoffAt,
        approvedByCurrentUser: proposal.approvedBy === caller.uid, lines: proposal.lines, cashCountMinor: proposal.cashCountMinor } : null,
      inventory: { schoolAvailableMinor: inventory.schoolAvailableMinor, cashAvailableMinor: inventory.cashAvailableMinor,
        fingerprint: inventory.fingerprint, evidenceCount: inventory.evidence.length, page,
        hasNext: (page + 1) * 200 < inventory.evidence.length, evidence: inventory.evidence.slice(page * 200, (page + 1) * 200).map(({ digest: _digest, ...row }) => row) } };
  });
}
