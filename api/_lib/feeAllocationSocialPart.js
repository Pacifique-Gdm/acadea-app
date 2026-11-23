/** Lot 27c-4 : partie 2 de la répartition, propre aux cas sociaux.
 *
 * - Une partie 2 par frais, publiée à part, pour un frais dont la partie 1 est publiée ; la partie 1, ses versions,
 *   les ancres et les mouvements déjà écrits ne sont jamais modifiés.
 * - Elle reprend exactement les rubriques de la partie 1 (seules les valeurs changent). « Non affecté » reçoit
 *   toujours le reste : le total peut être inférieur à 100 %, jamais supérieur.
 * - Version 1.19.0 : un seul formulaire pour tous les frais ; tous les frais modifiés sont publiés ensemble
 *   (tout passe ou rien ne passe), après la phrase « PUBLIER LA PARTIE DEUX » tapée par l'Administrateur.
 * - Elle s'applique aux paiements des cas sociaux arrivés après sa publication ; les mouvements déjà écrits ne changent jamais.
 * - Aucune autre écriture : ni registre, ni solde, ni paiement.
 */
import { feeAllocationConfigId, readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { sameAllocationRubrics, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { evidenceRevisionRef } from "./feeAllocationRevision.js";
import { allocationHash as hash, allocationFail as fail, allocationIdentifier as id } from "./feeAllocationRuntime.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";

export const socialPartActions = new Set(["get-social-part", "get-social-parts", "publish-social-part", "publish-social-parts"]);
/** Phrase que l'Administrateur tape lui-même pour publier une partie 2. */
export const SOCIAL_PUBLISH_CONFIRMATION = "PUBLIER LA PARTIE DEUX";
const MAX_SOCIAL_ITEMS = 100;
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

/** Rubriques de la partie 2 : exactement celles de la partie 1 ; une ligne retirée arrive comme une rubrique à 0 %. */
export function cleanSocialRubrics(input, partOne) {
  if (!Array.isArray(input) || input.length !== partOne.rubrics.length) fail("La partie 2 doit reprendre toutes les rubriques de la partie 1.", "invalid-argument", 400);
  const rubrics = partOne.rubrics.map((rubric) => {
    const given = input.find((item) => item?.id === rubric.id);
    if (!given || Object.keys(given).some((key) => !["id", "mode", "basisPoints", "fixedMinor"].includes(key))) fail("La partie 2 doit reprendre toutes les rubriques de la partie 1.", "invalid-argument", 400);
    return { id: rubric.id, name: rubric.name, mode: given.mode, ...(given.mode === "fixed" ? { fixedMinor: given.fixedMinor } : { basisPoints: given.basisPoints }) };
  });
  // Le contrôle refuse un total supérieur au tarif (plus de 100 %) ; le reste va toujours dans « Non affecté ».
  try { return validateFeeAllocationRubrics(rubrics, partOne.feeAmountMinor, { allowZero: true }).rubrics; }
  catch (error) { fail(error.message, "invalid-argument", 400); }
}

/** Nouvelle version de partie 2 d'un frais. */
export function buildSocialVersion({ configId, schoolId, yearId, feeTypeId, partOne, previous, rubrics, caller, now }) {
  const number = (previous?.partOneVersionId === partOne.id ? previous.version : 0) + 1;
  return { id: socialVersionId(configId, partOne.id, number), configId, schoolId, schoolYearId: yearId, feeTypeId, currency: partOne.currency,
    partOneVersionId: partOne.id, feeAmountMinor: partOne.feeAmountMinor, version: number, rubrics,
    copyOfPartOne: sameAllocationRubrics(partOne.rubrics, rubrics), status: "published", effectiveFrom: now, publishedBy: caller.uid, createdAt: now };
}

const countPaidWithCurrent = async (db, schoolId, feeTypeId, current) => current ? (await db.collection("feeAllocationAnchors").where("schoolId", "==", schoolId)
  .where("feeTypeId", "==", feeTypeId).where("socialCurrentVersionId", "==", current.id).get()).docs.length : 0;

export async function manageSocialPart({ db, caller, body, now = new Date().toISOString() }) {
  if (!socialPartActions.has(body.action)) fail("Action inconnue.", "invalid-argument", 400);
  // Règle du propriétaire : seul l'Administrateur de l'école lit ou publie la partie 2 (cas sociaux).
  if (!isAdmin(caller?.role)) fail("Partie 2 réservée à l'Administrateur de l'école.", "permission-denied", 403);
  // Une page ouverte avant la version 1.19.0 envoie encore l'ancienne publication d'un seul frais, sans la phrase tapée.
  if (body.action === "publish-social-part") fail("Cette page est ancienne. Actualisez-la, puis publiez la partie 2 depuis le nouveau formulaire.");
  if (body.action === "get-social-part") {
    if (Object.keys(body).some((key) => !["action", "schoolId", "feeTypeId"].includes(key)) || !id(body.feeTypeId)) fail("Demande invalide.", "invalid-argument", 400);
    const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
    const { yearId } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
    const config = (await db.doc(`feeAllocationConfigs/${feeAllocationConfigId(schoolId, yearId, body.feeTypeId)}`).get()).data();
    if (config && (config.schoolId !== schoolId || config.schoolYearId !== yearId)) fail("Configuration hors périmètre.", "permission-denied", 403);
    const partOne = config?.currentVersionId ? (await db.doc(`feeAllocationVersions/${config.currentVersionId}`).get()).data() : null;
    const history = config ? (await db.collection("feeAllocationSocialVersions").where("configId", "==", config.id).get()).docs.map((d) => d.data()) : [];
    const current = history.find((item) => item.id === config?.socialVersionId) ?? null;
    return { partOne: partOne && partOne.status === "published" ? partOne : null, social: current, paidWithCurrent: await countPaidWithCurrent(db, schoolId, body.feeTypeId, current),
      history: history.sort((a, b) => b.version - a.version), operational: false };
  }
  if (body.action === "get-social-parts") {
    // Version 1.19.0 : tous les frais répartis (partie 1 publiée) de l'école et de l'année, pour un seul formulaire.
    if (Object.keys(body).some((key) => !["action", "schoolId"].includes(key))) fail("Demande invalide.", "invalid-argument", 400);
    const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
    const { yearId } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
    const configs = (await db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get())
      .docs.map((d) => d.data()).filter((config) => config?.currentVersionId && config.schoolId === schoolId).slice(0, MAX_SOCIAL_ITEMS);
    const items = await Promise.all(configs.map(async (config) => {
      const [partOneSnap, socialSnap, feeSnap] = await Promise.all([db.doc(`feeAllocationVersions/${config.currentVersionId}`).get(),
        config.socialVersionId ? db.doc(`feeAllocationSocialVersions/${config.socialVersionId}`).get() : null, db.doc(`feeTypes/${config.feeTypeId}`).get()]);
      const partOne = partOneSnap.data(), social = socialSnap?.data() ?? null, fee = feeSnap.data();
      if (!partOne || partOne.status !== "published" || partOne.schoolId !== schoolId) return null;
      const current = social && social.partOneVersionId === partOne.id && social.status === "published" ? social : null;
      return { feeTypeId: config.feeTypeId, feeName: String(fee?.name ?? "Frais"), className: config.className ?? null, classOptionKey: config.classOptionKey ?? null,
        partOne, social: current, paidWithCurrent: await countPaidWithCurrent(db, schoolId, config.feeTypeId, current) };
    }));
    const label = (item) => String(item.classOptionKey || item.className || "");
    return { items: items.filter(Boolean).sort((a, b) => a.feeName.localeCompare(b.feeName, "fr") || label(a).localeCompare(label(b), "fr")), operational: false };
  }
  // publish-social-parts : tous les frais modifiés en une seule fois, tout passe ou rien ne passe.
  if (Object.keys(body).some((key) => !["action", "requestId", "confirmation", "items"].includes(key))) fail("Demande invalide.", "invalid-argument", 400);
  if (!isAdmin(caller.role)) fail("Action réservée à l'Administrateur.", "permission-denied", 403);
  if (body.confirmation !== SOCIAL_PUBLISH_CONFIRMATION) fail(`Tapez exactement « ${SOCIAL_PUBLISH_CONFIRMATION} » pour publier la partie 2.`, "invalid-argument", 400);
  if (!id(body.requestId) || body.requestId.length < 12 || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_SOCIAL_ITEMS
    || body.items.some((item) => !item || typeof item !== "object" || Object.keys(item).some((key) => !["feeTypeId", "expectedPartOneVersionId", "expectedSocialVersionId", "rubrics"].includes(key))
      || !id(item.feeTypeId) || !id(item.expectedPartOneVersionId) || !(item.expectedSocialVersionId === null || id(item.expectedSocialVersionId)))
    || new Set(body.items.map((item) => item.feeTypeId)).size !== body.items.length) fail("Demande invalide.", "invalid-argument", 400);
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
    // Toutes les lectures d'abord (règle des transactions), puis toutes les écritures.
    const rows = [];
    for (const item of body.items) {
      const configId = feeAllocationConfigId(schoolId, yearId, item.feeTypeId);
      const configRef = db.doc(`feeAllocationConfigs/${configId}`);
      const config = (await tx.get(configRef)).data();
      if (!config || config.schoolId !== schoolId || config.schoolYearId !== yearId || config.feeTypeId !== item.feeTypeId) fail("Publiez d'abord la partie 1 de ce frais.");
      if (config.currentVersionId !== item.expectedPartOneVersionId) fail("La partie 1 d'un frais a changé. Actualisez avant de publier la partie 2.");
      if ((config.socialVersionId ?? null) !== item.expectedSocialVersionId) fail("La partie 2 d'un frais a changé. Actualisez avant de la publier.");
      const partOne = (await tx.get(db.doc(`feeAllocationVersions/${config.currentVersionId}`))).data();
      if (!partOne || partOne.status !== "published" || partOne.configId !== configId || partOne.schoolId !== schoolId || partOne.feeTypeId !== item.feeTypeId) fail("Publiez d'abord la partie 1 de ce frais.");
      const rubrics = cleanSocialRubrics(item.rubrics, partOne);
      const previousRef = config.socialVersionId ? db.doc(`feeAllocationSocialVersions/${config.socialVersionId}`) : null;
      const previous = previousRef ? (await tx.get(previousRef)).data() : null;
      if (previousRef && (!previous || previous.configId !== configId)) fail("Partie 2 précédente introuvable.");
      const version = buildSocialVersion({ configId, schoolId, yearId, feeTypeId: item.feeTypeId, partOne, previous, rubrics, caller, now });
      const versionRef = db.doc(`feeAllocationSocialVersions/${version.id}`);
      if ((await tx.get(versionRef)).exists) fail("Cette partie 2 a déjà été publiée.");
      rows.push({ configId, configRef, previousRef, versionRef, version });
    }
    for (const { configId, configRef, previousRef, versionRef, version } of rows) {
      tx.create(versionRef, version);
      if (previousRef) tx.update(previousRef, { status: "superseded", supersededAt: now });
      tx.update(configRef, { socialVersionId: version.id });
      const auditId = `audit_allocation_${hash([caller.uid, schoolId, "social", body.requestId, version.feeTypeId]).slice(0, 32)}`;
      tx.create(db.doc(`auditLogs/${auditId}`), buildServerAudit({ id: auditId, eventType: AUDIT_EVENT_TYPES.FINANCE_ALLOCATION_SOCIAL_PART_PUBLISHED,
        actor: caller, schoolId, schoolYearId: yearId, resourceType: "feeAllocation", resourceId: configId,
        metadata: { feeTypeId: version.feeTypeId, socialVersion: version.version, copyOfPartOne: version.copyOfPartOne, publishedTogether: rows.length } }));
    }
    tx.set(evidenceRevisionRef(db, schoolId, yearId), { schoolId, schoolYearId: yearId, revision: fingerprint });
    tx.set(db.doc(`feeAllocationForecastSignals/${hash([schoolId, yearId])}`), { schoolId, schoolYearId: yearId, revision: fingerprint });
    const result = { socials: rows.map((row) => row.version), operational: false };
    tx.create(receiptRef, { schoolId, schoolYearId: yearId, userId: caller.uid, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}
