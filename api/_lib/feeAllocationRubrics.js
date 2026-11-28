import { createHash, randomBytes } from "node:crypto";
import { FeeAllocationError } from "./feeAllocationMath.js";
import { readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { SUB_REST_MOVEMENT_TYPE, SUB_REST_PHRASE, SUB_RUBRICS_PHRASE, keptSocialSubOverrides, nextSubBalances, subRestShares, subRubricAmountsKey, subRubricBalanceView, subRubricViewOptions, readKeptForecastRows, validateSubRubrics } from "./feeAllocationSubRubrics.js";
import { allocationBalanceId, allocationStateId } from "./feeAllocationRuntime.js";

/** Lot 27b — catalogue des rubriques de la répartition des frais (décision du propriétaire, 16/11/2026).
 * - Propre à chaque école ET à chaque année scolaire (une nouvelle année commence avec une liste vide).
 * - « Ajouter une rubrique » l'enregistre ; elle est ensuite réutilisable (même identifiant, donc même solde : pas de doublon).
 * - Renommer : toujours possible. Supprimer : seulement si elle n'a jamais servi ; sinon la masquer (l'historique reste).
 * - La marque `feeAllocationRubricCatalogs/{école__année}` indique que l'école utilise le catalogue ; sans elle,
 *   l'ancien fonctionnement (rubriques de la répartition active) reste inchangé. */
export const UNALLOCATED = "UNALLOCATED";
export const rubricCatalogId = (schoolId, schoolYearId) => `${schoolId}__${schoolYearId}`;
const fail = (status, code, message) => { throw new FeeAllocationError(status, code, message); };
const isAdmin = (role) => role === "school_admin" || role === "admin";
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export const rubricNameKey = (name) => String(name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function cleanName(name) {
  const value = typeof name === "string" ? name.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (!value || value.length > 80) fail(400, "invalid-argument", "Le nom de la rubrique doit contenir de 1 à 80 caractères.");
  if (rubricNameKey(value) === rubricNameKey("Non affecté")) fail(400, "invalid-argument", "« Non affecté » est réservé : choisissez un autre nom.");
  return value;
}

export async function readRubricCatalog(db, schoolId, schoolYearId, reader = null) {
  const get = (ref) => (reader ? reader.get(ref) : ref.get());
  const marker = await get(db.doc(`feeAllocationRubricCatalogs/${rubricCatalogId(schoolId, schoolYearId)}`));
  const snapshot = await get(db.collection("feeAllocationRubrics").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId));
  const rubrics = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { enabled: marker.exists, rubrics };
}

/** Une rubrique a « servi » dès qu'un brouillon, une version ou un solde la mentionne. */
async function rubricUsage(db, transaction, schoolId, schoolYearId, rubricId) {
  const [configs, versions, balances] = await Promise.all([
    transaction.get(db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
    transaction.get(db.collection("feeAllocationVersions").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
    transaction.get(db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId)),
  ]);
  return configs.docs.some((doc) => (doc.data().draft?.rubrics ?? []).some((rubric) => rubric.id === rubricId))
    || versions.docs.some((doc) => (doc.data().rubrics ?? []).some((rubric) => rubric.id === rubricId))
    || balances.docs.some((doc) => doc.data().rubricId === rubricId);
}

/** Identifiants des rubriques déjà mentionnées par un brouillon, une version ou un solde (même règle que la suppression). */
async function usedRubricIds(db, schoolId, schoolYearId) {
  const [configs, versions, balances] = await Promise.all([
    db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
    db.collection("feeAllocationVersions").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
    db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId).get(),
  ]);
  return new Set([...configs.docs.flatMap((d) => (d.data().draft?.rubrics ?? []).map((r) => r.id)),
    ...versions.docs.flatMap((d) => (d.data().rubrics ?? []).map((r) => r.id)), ...balances.docs.map((d) => d.data().rubricId)]);
}

/** « Répartir le Reste » (décision de l'utilisateur du 28/11/2026) : ce qui serait réparti, même calcul pour l'aperçu
 * et l'enregistrement (soldes des sous-rubriques et part de l'ouverture comme chez le Caissier). Une seule fois par rubrique. */
async function readSubRest(db, reader, schoolId, yearId, currency, rubric) {
  const subs = Array.isArray(rubric.subRubrics) && rubric.subRubrics.length
    ? validateSubRubrics(rubric.subRubrics, { newId: () => fail(409, "allocation-reconciliation-required", "Sous-rubrique enregistrée sans identifiant.") }) : [];
  if (!subs.length) fail(409, "failed-precondition", "Cette rubrique n'a pas de sous-rubriques.");
  if (rubric.restRedistribution) fail(409, "conflict", "Le Reste de cette rubrique a déjà été réparti : cette action ne se fait qu'une fois.");
  const balanceRef = db.doc(`feeAllocationBalances/${allocationBalanceId(schoolId, yearId, currency, rubric.id)}`);
  const balance = (await (reader ? reader.get(balanceRef) : balanceRef.get())).data();
  if (!balance || balance.schoolId !== schoolId || balance.collectionSchoolYearId !== yearId || balance.currency !== currency || balance.rubricId !== rubric.id) fail(409, "failed-precondition", "Rien à répartir : « Reste » est vide.");
  const options = subRubricViewOptions({ ...rubric, subRubrics: subs }, balance, await readKeptForecastRows(reader, db, schoolId, yearId, currency));
  const restMinor = subRubricBalanceView(balance, subs, rubric.name, options).at(-1).availableMinor;
  const lines = restMinor > 0 ? subRestShares(subs, restMinor, options.planned) : [];
  if (!lines.length) fail(409, "failed-precondition", "Rien à répartir : « Reste » est vide.");
  const totalMinor = lines.reduce((n, line) => n + line.amountMinor, 0);
  return { balanceRef, balance, restMinor, lines, totalMinor, remainingMinor: restMinor - totalMinor };
}

export async function manageFeeAllocationRubrics({ db, caller, body, now = new Date().toISOString() }) {
  const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
  const { yearId, currency } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
  if (body.action === "list-rubrics") {
    const catalog = await readRubricCatalog(db, schoolId, yearId);
    // Lot « Deux onglets » : « Supprimer » ne s'affiche que pour une rubrique qui n'a jamais servi.
    const used = isAdmin(caller.role) ? await usedRubricIds(db, schoolId, yearId) : new Set();
    // Lots 5 et 6 : soldes des sous-rubriques (Administrateur), dans la devise de l'année.
    const withSubs = isAdmin(caller.role) ? catalog.rubrics.filter((r) => Array.isArray(r.subRubrics) && r.subRubrics.length) : [];
    const subBalances = new Map(await Promise.all(withSubs.map(async (r) => [r.id, (await db.doc(`feeAllocationBalances/${allocationBalanceId(schoolId, yearId, currency, r.id)}`).get()).data()])));
    // F2 (28/11/2026) : part de l'ouverture des sous-rubriques, avec le même prévu gardé que les tableaux.
    const forecastRows = withSubs.length ? await readKeptForecastRows(null, db, schoolId, yearId, currency) : null;
    return { operational: false, schoolId, schoolYearId: yearId, currency, ...catalog, rubrics: catalog.rubrics.map((r) => ({ ...r, used: used.has(r.id),
      ...(subBalances.has(r.id) ? { subView: subRubricBalanceView(subBalances.get(r.id), r.subRubrics, r.name, subRubricViewOptions(r, subBalances.get(r.id), forecastRows)) } : {}) })) };
  }
  if (!isAdmin(caller.role) || caller.schoolId !== schoolId) fail(403, "permission-denied", "Seul l'Administrateur gère les rubriques.");
  if (body.action === "preview-sub-rest") {
    // Aperçu de « Répartir le Reste » : lecture seule, rien n'est écrit.
    const rubric = (await readRubricCatalog(db, schoolId, yearId)).rubrics.find((item) => item.id === body.rubricId);
    if (!rubric) fail(404, "not-found", "Rubrique introuvable pour cette école et cette année.");
    const plan = await readSubRest(db, null, schoolId, yearId, currency, rubric);
    return { operational: false, currency, preview: { restMinor: plan.restMinor, totalMinor: plan.totalMinor, remainingMinor: plan.remainingMinor, lines: plan.lines } };
  }
  if (!id(body.requestId) || body.requestId.length < 12) fail(400, "invalid-argument", "Clé de requête invalide.");
  const receiptRef = db.doc(`feeAllocationRequests/rubric_${hash([caller.uid, schoolId, body.requestId])}`);
  // Lots 5 et 6 : l'empreinte d'un enregistrement de sous-rubriques comprend la liste et la phrase (ancienne empreinte inchangée sinon).
  const fingerprint = hash([body.action, body.rubricId ?? null, body.name ?? null, body.hidden ?? null,
    ...(body.action === "save-sub-rubrics" ? [body.subRubrics ?? null, body.confirmation ?? null] : []), ...(body.action === "redistribute-sub-rest" ? [body.confirmation ?? null] : [])]);
  return db.runTransaction(async (transaction) => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().fingerprint !== fingerprint) fail(409, "conflict", "Cette demande a déjà un autre contenu.");
      return { operational: false, ...receipt.data().result, idempotent: true };
    }
    const catalog = await readRubricCatalog(db, schoolId, yearId, transaction);
    const markerRef = db.doc(`feeAllocationRubricCatalogs/${rubricCatalogId(schoolId, yearId)}`);
    const sameName = (name, exceptId) => catalog.rubrics.some((rubric) => rubric.id !== exceptId && rubricNameKey(rubric.name) === rubricNameKey(name));
    let result;
    if (body.action === "create-rubric") {
      const name = cleanName(body.name);
      if (sameName(name)) fail(409, "conflict", "Une rubrique porte déjà ce nom : choisissez-la dans la liste.");
      const rubricId = randomBytes(16).toString("hex");
      const rubric = { id: rubricId, schoolId, schoolYearId: yearId, name, hidden: false, createdAt: now, updatedAt: now, createdBy: caller.uid };
      transaction.create(db.doc(`feeAllocationRubrics/${rubricId}`), rubric);
      if (!catalog.enabled) transaction.set(markerRef, { schoolId, schoolYearId: yearId, enabledAt: now, enabledBy: caller.uid }, { merge: true });
      result = { rubric };
    } else {
      const rubric = catalog.rubrics.find((item) => item.id === body.rubricId);
      if (!rubric) fail(404, "not-found", "Rubrique introuvable pour cette école et cette année.");
      const ref = db.doc(`feeAllocationRubrics/${rubric.id}`);
      if (body.action === "rename-rubric") {
        const name = cleanName(body.name);
        if (sameName(name, rubric.id)) fail(409, "conflict", "Une autre rubrique porte déjà ce nom.");
        transaction.update(ref, { name, updatedAt: now, updatedBy: caller.uid });
        result = { rubric: { ...rubric, name } };
      } else if (body.action === "set-rubric-hidden") {
        if (typeof body.hidden !== "boolean") fail(400, "invalid-argument", "Indiquez si la rubrique est masquée.");
        transaction.update(ref, { hidden: body.hidden, updatedAt: now, updatedBy: caller.uid });
        result = { rubric: { ...rubric, hidden: body.hidden } };
      } else if (body.action === "delete-rubric") {
        if (await rubricUsage(db, transaction, schoolId, yearId, rubric.id)) fail(409, "conflict", "Cette rubrique a déjà servi : elle ne peut pas être supprimée, seulement masquée.");
        transaction.delete(ref);
        result = { deletedId: rubric.id };
      } else if (body.action === "save-sub-rubrics") {
        // Lots 5 et 6 : une seule répartition par rubrique, pour tous les frais. Phrase tapée à la main avant tout
        // changement de pourcentage ou de montant ; une sous-rubrique qui a servi ne peut pas être retirée.
        // F2 : rien ne s'enregistre tant que la répartition n'est pas activée.
        const state = (await transaction.get(db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`))).data();
        if (!["ACTIVE", "PAUSED"].includes(state?.status)) fail(409, "failed-precondition", "Les sous-rubriques seront disponibles quand la répartition sera activée.");
        const saved = Array.isArray(rubric.subRubrics) ? rubric.subRubrics : [];
        const subRubrics = validateSubRubrics(body.subRubrics);
        if (subRubrics.some((sub) => !saved.some((old) => old.id === sub.id) && body.subRubrics.some((input) => input?.id === sub.id))) fail(400, "invalid-argument", "Sous-rubrique inconnue pour cette rubrique.");
        if (subRubricAmountsKey(saved) !== subRubricAmountsKey(subRubrics) && body.confirmation !== SUB_RUBRICS_PHRASE) fail(400, "invalid-argument", `Tapez à la main « ${SUB_RUBRICS_PHRASE} » pour changer un pourcentage ou un montant.`);
        const removed = saved.filter((old) => !subRubrics.some((sub) => sub.id === old.id));
        if (removed.length) {
          const balances = await transaction.get(db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", yearId));
          const usedSub = removed.find((old) => balances.docs.some((doc) => { const own = doc.data().rubricId === rubric.id ? doc.data().subBalances?.[old.id] : null; return !!own && ((own.receivedMinor ?? 0) !== 0 || (own.spentMinor ?? 0) !== 0); }));
          if (usedSub) fail(409, "conflict", `La sous-rubrique « ${usedSub.name} » a déjà servi : elle ne peut pas être retirée.`);
        }
        // F2 : les écarts des cas sociaux (partie 2) suivent ; ceux d'une sous-rubrique retirée sont oubliés.
        const socialSubRubrics = keptSocialSubOverrides(rubric.socialSubRubrics, subRubrics);
        transaction.update(ref, { subRubrics, ...(socialSubRubrics ? { socialSubRubrics } : {}), updatedAt: now, updatedBy: caller.uid });
        result = { rubric: { ...rubric, subRubrics, ...(socialSubRubrics ? { socialSubRubrics } : {}) } };
      } else if (body.action === "redistribute-sub-rest") {
        // « Répartir le Reste » : une seule fois par rubrique, phrase tapée exactement, mouvement daté. Le total de la
        // rubrique ne change pas ; les anciens mouvements ne sont pas réécrits.
        if (body.confirmation !== SUB_REST_PHRASE) fail(400, "invalid-argument", `Tapez exactement « ${SUB_REST_PHRASE} » pour confirmer.`);
        const state = (await transaction.get(db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`))).data();
        if (!["ACTIVE", "PAUSED"].includes(state?.status)) fail(409, "failed-precondition", "La répartition n'est pas activée.");
        const plan = await readSubRest(db, transaction, schoolId, yearId, currency, rubric);
        const movementId = `subrest_${hash([schoolId, yearId, currency, rubric.id]).slice(0, 40)}`;
        const movementRef = db.doc(`feeAllocationMovements/${movementId}`);
        if ((await transaction.get(movementRef)).exists) fail(409, "conflict", "Le Reste de cette rubrique a déjà été réparti : cette action ne se fait qu'une fois.");
        const subLines = plan.lines.map(({ subRubricId, amountMinor }) => ({ rubricId: rubric.id, subRubricId, amountMinor }));
        transaction.create(movementRef, { id: movementId, schoolId, collectionSchoolYearId: yearId, originSchoolYearId: yearId, currency, sourceType: "transfer",
          sourceId: rubric.id, sourceRevision: body.requestId, type: SUB_REST_MOVEMENT_TYPE, amountMinor: 0, lines: [{ rubricId: rubric.id, amountMinor: 0 }], subLines,
          postedAt: now, collectedAt: now, actorId: caller.uid, socialCase: false, ...(state.testOnly ? { testOnly: true } : {}) });
        transaction.update(plan.balanceRef, { subBalances: nextSubBalances(plan.balance, subLines), updatedAt: now });
        const restRedistribution = { at: now, by: caller.uid, movementId, amountMinor: plan.totalMinor };
        transaction.update(ref, { restRedistribution, updatedAt: now, updatedBy: caller.uid });
        result = { rubric: { ...rubric, restRedistribution }, redistributed: { restMinor: plan.restMinor, totalMinor: plan.totalMinor, remainingMinor: plan.remainingMinor, lines: plan.lines } };
      } else fail(400, "invalid-argument", "Action inconnue sur les rubriques.");
    }
    // Lot « répartition rapide » : chaque changement de rubrique change la révision du catalogue,
    // pour que les drawers ouverts ou préparés se mettent à jour.
    if (catalog.enabled || body.action === "create-rubric") transaction.set(markerRef, { schoolId, schoolYearId: yearId, revision: hash([fingerprint, now]) }, { merge: true });
    transaction.create(receiptRef, { schoolId, schoolYearId: yearId, fingerprint, result, createdAt: now });
    return { operational: false, ...result, idempotent: false };
  });
}

export const rubricActions = new Set(["list-rubrics", "create-rubric", "rename-rubric", "set-rubric-hidden", "delete-rubric", "save-sub-rubrics", "preview-sub-rest", "redistribute-sub-rest"]);
