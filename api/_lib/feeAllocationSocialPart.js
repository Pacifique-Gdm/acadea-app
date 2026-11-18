/** Lot 27c-4 : partie 2 de la répartition, propre aux cas sociaux.
 *
 * - Elle est publiée à part, pour un frais dont la partie 1 est publiée ; la partie 1, ses versions,
 *   les ancres et les mouvements déjà écrits ne sont jamais modifiés.
 * - Elle reprend exactement les rubriques de la partie 1 (seules les valeurs changent).
 * - Elle ne s'applique qu'aux cas sociaux dont le PREMIER paiement réparti de ce frais arrive après sa
 *   publication : leur ancre garde alors la partie 2 et le net dû, pour toutes leurs corrections.
 * - Aucune autre écriture : ni registre, ni solde, ni paiement.
 */
import { feeAllocationConfigId, readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { sameAllocationRubrics, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { evidenceRevisionRef } from "./feeAllocationRevision.js";
import { allocationHash as hash, allocationFail as fail, allocationIdentifier as id } from "./feeAllocationRuntime.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";

export const socialPartActions = new Set(["get-social-part", "publish-social-part"]);
const active = (p) => p && p.active !== false && !["inactive", "disabled", "suspended", "deleted", "deleting"].includes(p.status);
const isAdmin = (role) => role === "school_admin" || role === "admin";
export const socialVersionId = (configId, partOneVersionId, version) => `social_version_${hash([configId, partOneVersionId, version]).slice(0, 40)}`;

/** Vérifie qu'une version de partie 2 correspond bien à la partie 1 et au frais attendus. */
export function assertSocialVersionBinding(social, { schoolId, schoolYearId, feeTypeId, currency, partOneVersionId, feeAmountMinor }) {
  if (!social || social.schoolId !== schoolId || social.schoolYearId !== schoolYearId || social.feeTypeId !== feeTypeId
    || social.currency !== currency || social.partOneVersionId !== partOneVersionId || social.feeAmountMinor !== feeAmountMinor
    || !["published", "superseded"].includes(social.status) || typeof social.effectiveFrom !== "string" || !Number.isFinite(Date.parse(social.effectiveFrom))) {
    fail("Partie 2 des cas sociaux non vérifiée.");
  }
  return social;
}

function cleanRubrics(input, partOne) {
  if (!Array.isArray(input) || input.length !== partOne.rubrics.length) fail("La partie 2 doit reprendre toutes les rubriques de la partie 1.", "invalid-argument", 400);
  const rubrics = partOne.rubrics.map((rubric) => {
    const given = input.find((item) => item?.id === rubric.id);
    if (!given || Object.keys(given).some((key) => !["id", "mode", "basisPoints", "fixedMinor"].includes(key))) fail("La partie 2 doit reprendre toutes les rubriques de la partie 1.", "invalid-argument", 400);
    return { id: rubric.id, name: rubric.name, mode: given.mode, ...(given.mode === "fixed" ? { fixedMinor: given.fixedMinor } : { basisPoints: given.basisPoints }) };
  });
  try { return validateFeeAllocationRubrics(rubrics, partOne.feeAmountMinor).rubrics; }
  catch (error) { fail(error.message, "invalid-argument", 400); }
}

export async function manageSocialPart({ db, caller, body, now = new Date().toISOString() }) {
  if (!socialPartActions.has(body.action)) fail("Action inconnue.", "invalid-argument", 400);
  const allowed = body.action === "get-social-part" ? ["action", "schoolId", "feeTypeId"]
    : ["action", "feeTypeId", "requestId", "expectedPartOneVersionId", "expectedSocialVersionId", "rubrics"];
  if (Object.keys(body).some((key) => !allowed.includes(key)) || !id(body.feeTypeId)) fail("Demande invalide.", "invalid-argument", 400);
  if (body.action === "get-social-part") {
    const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
    const { yearId } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
    const config = (await db.doc(`feeAllocationConfigs/${feeAllocationConfigId(schoolId, yearId, body.feeTypeId)}`).get()).data();
    if (config && (config.schoolId !== schoolId || config.schoolYearId !== yearId)) fail("Configuration hors périmètre.", "permission-denied", 403);
    const partOne = config?.currentVersionId ? (await db.doc(`feeAllocationVersions/${config.currentVersionId}`).get()).data() : null;
    const history = config ? (await db.collection("feeAllocationSocialVersions").where("configId", "==", config.id).get()).docs.map((d) => d.data()) : [];
    const current = history.find((item) => item.id === config?.socialVersionId) ?? null;
    return { partOne: partOne && partOne.status === "published" ? partOne : null, social: current,
      history: history.sort((a, b) => b.version - a.version), operational: false };
  }
  if (!isAdmin(caller.role)) fail("Action réservée à l'Administrateur.", "permission-denied", 403);
  if (!id(body.requestId) || body.requestId.length < 12 || !id(body.expectedPartOneVersionId)
    || !(body.expectedSocialVersionId === null || id(body.expectedSocialVersionId))) fail("Demande invalide.", "invalid-argument", 400);
  await readFeeAllocationScope(db, caller, caller.schoolId);
  const schoolId = caller.schoolId, fingerprint = hash(body);
  const receiptRef = db.doc(`feeAllocationRequests/social_${hash([caller.uid, schoolId, body.requestId])}`);
  return db.runTransaction(async (tx) => {
    const [schoolSnap, userSnap, receiptSnap] = await Promise.all([tx.get(db.doc(`schools/${schoolId}`)), tx.get(db.doc(`users/${caller.uid}`)), tx.get(receiptRef)]);
    const school = schoolSnap.data(), user = userSnap.data();
    if (!active(school) || !active(user) || !isAdmin(user.role) || user.schoolId !== schoolId) fail("Compte non autorisé.", "permission-denied", 403);
    if (receiptSnap.exists) {
      const receipt = receiptSnap.data();
      if (receipt.userId !== caller.uid || receipt.fingerprint !== fingerprint) fail("Clé déjà utilisée avec un autre contenu.");
      return { ...receipt.result, idempotent: true };
    }
    const yearId = school.activeSchoolYearId;
    const year = id(yearId) ? (await tx.get(db.doc(`schoolYears/${yearId}`))).data() : null;
    if (!year || year.schoolId !== schoolId || year.status !== "active") fail("Seule l'année scolaire active peut recevoir une partie 2.");
    const configId = feeAllocationConfigId(schoolId, yearId, body.feeTypeId);
    const configRef = db.doc(`feeAllocationConfigs/${configId}`);
    const config = (await tx.get(configRef)).data();
    if (!config || config.schoolId !== schoolId || config.schoolYearId !== yearId || config.feeTypeId !== body.feeTypeId) fail("Publiez d'abord la partie 1 de ce frais.");
    if (config.currentVersionId !== body.expectedPartOneVersionId) fail("La partie 1 a changé. Actualisez avant de publier la partie 2.");
    if ((config.socialVersionId ?? null) !== body.expectedSocialVersionId) fail("La partie 2 a changé. Actualisez avant de la publier.");
    const partOne = (await tx.get(db.doc(`feeAllocationVersions/${config.currentVersionId}`))).data();
    if (!partOne || partOne.status !== "published" || partOne.configId !== configId || partOne.schoolId !== schoolId || partOne.feeTypeId !== body.feeTypeId) fail("Publiez d'abord la partie 1 de ce frais.");
    const rubrics = cleanRubrics(body.rubrics, partOne);
    const previousRef = config.socialVersionId ? db.doc(`feeAllocationSocialVersions/${config.socialVersionId}`) : null;
    const previous = previousRef ? (await tx.get(previousRef)).data() : null;
    if (previousRef && (!previous || previous.configId !== configId)) fail("Partie 2 précédente introuvable.");
    const number = (previous?.partOneVersionId === partOne.id ? previous.version : 0) + 1;
    const versionId = socialVersionId(configId, partOne.id, number);
    const versionRef = db.doc(`feeAllocationSocialVersions/${versionId}`);
    if ((await tx.get(versionRef)).exists) fail("Cette partie 2 a déjà été publiée.");
    const version = { id: versionId, configId, schoolId, schoolYearId: yearId, feeTypeId: body.feeTypeId, currency: partOne.currency,
      partOneVersionId: partOne.id, feeAmountMinor: partOne.feeAmountMinor, version: number, rubrics,
      copyOfPartOne: sameAllocationRubrics(partOne.rubrics, rubrics), status: "published", effectiveFrom: now, publishedBy: caller.uid, createdAt: now };
    tx.create(versionRef, version);
    if (previousRef) tx.update(previousRef, { status: "superseded", supersededAt: now });
    tx.update(configRef, { socialVersionId: versionId });
    const auditId = `audit_allocation_${hash([caller.uid, schoolId, "social", body.requestId]).slice(0, 32)}`;
    tx.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_ALLOCATION_SOCIAL_PART_PUBLISHED,
      actor: caller, schoolId, schoolYearId: yearId, resourceType: "feeAllocation", resourceId: configId,
      metadata: { feeTypeId: body.feeTypeId, socialVersion: number, copyOfPartOne: version.copyOfPartOne } }));
    tx.set(evidenceRevisionRef(db, schoolId, yearId), { schoolId, schoolYearId: yearId, revision: fingerprint });
    tx.set(db.doc(`feeAllocationForecastSignals/${hash([schoolId, yearId])}`), { schoolId, schoolYearId: yearId, revision: fingerprint });
    const result = { social: version, operational: false };
    tx.create(receiptRef, { schoolId, schoolYearId: yearId, userId: caller.uid, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}
