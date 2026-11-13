import { readFeeAllocationScope, readFeeAllocationYear } from "./feeAllocationPhase1.js";
import { validateFeeAllocationRubrics, assertFeeAllocationActivationBlocked } from "./feeAllocationMath.js";
import { toMoneyMinor } from "./money.js";
import { allocationHash as hash, allocationStateId, allocationBalanceId, allocationFail as fail,
  allocationIdentifier as id, allocationMinor as minor, readAllocationTestScope } from "./feeAllocationRuntime.js";

export const allocationLifecycleActions = new Set(["publish-configuration", "prepare-opening", "approve-opening", "activate", "pause", "resume"]);
const active = p => p && p.active !== false && !["inactive", "disabled", "suspended", "deleted", "deleting"].includes(p.status);
const sum = values => { const n = values.reduce((a, b) => a + BigInt(b), 0n); if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) fail("Total financier incohérent."); return Number(n); };

/** Bounded, exhaustive snapshot. No subset of selected receipts proves a balance.
 * Larger inventories fail closed; no silent truncation or automatic opening. */
async function openingInventory(db, tx, schoolId, yearId, currency) {
  const snapshots = await Promise.all(["payments", "expenses", "cashInflows"].map(async collection => {
    const q = db.collection(collection).where("schoolId", "==", schoolId).limit(201);
    const s = await tx.get(q);
    if (s.docs.length > 200) fail("Inventaire supérieur à la limite de rapprochement atomique ; traitement paginé requis.");
    return s.docs.map(d => ({ collection, id: d.id, data: d.data() }));
  }));
  const records = snapshots.flat().filter(r => (r.data.collectionSchoolYearId ?? r.data.schoolYearId) === yearId);
  if (records.length > 200) fail("Trop de pièces pour un rapprochement atomique.");
  const relevant = [];
  for (const r of records) {
    if (!["CDF", "USD"].includes(r.data.currency) || !Number.isFinite(Date.parse(r.data.createdAt))) fail("Devise ou date historique non prouvée.");
    if (r.data.currency !== currency) continue;
    if (r.collection === "payments" && (r.data.provenance !== "financial-api" || !r.data.clientRequestIdHash)) fail("Encaissement historique sans preuve serveur.");
    if (r.collection === "expenses" && !["financial-api", "personnel-payroll"].includes(r.data.provenance)) fail("Décaissement historique sans preuve serveur.");
    relevant.push({ ...r, minor: toMoneyMinor(r.data.amount) });
  }
  const receipts = sum(relevant.filter(r => r.collection === "payments").map(r => r.minor));
  const spent = sum(relevant.filter(r => r.collection === "expenses").map(r => r.minor));
  const other = sum(relevant.filter(r => r.collection === "cashInflows").map(r => r.minor));
  // Conservatively debit all historical expenditure from justified school funds.
  // Donations never become an allocation opening merely because cash is positive.
  if (spent > receipts) fail("Origine des fonds historiques à rapprocher : dépenses supérieures aux recettes scolaires prouvées.");
  const evidence = relevant.sort((a, b) => `${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`))
    .map(r => ({ collection: r.collection, id: r.id, amountMinor: r.minor, digest: hash(r.data) }));
  return { evidence, fingerprint: hash(evidence), schoolAvailableMinor: receipts - spent, cashAvailableMinor: sum([receipts - spent, other]) };
}

export async function manageFeeAllocationLifecycle({ db, caller, body, now = new Date().toISOString() }) {
  if (!allocationLifecycleActions.has(body.action)) fail("Action inconnue.", "invalid-argument", 400);
  if (!["admin", "school_admin"].includes(caller.role)) fail("Action réservée à l'Administrateur.", "permission-denied", 403);
  await readFeeAllocationScope(db, caller, caller.schoolId);
  if (!await readAllocationTestScope(db, null, caller.schoolId, now)) assertFeeAllocationActivationBlocked();
  const allowed = { "publish-configuration": ["versionId"], "prepare-opening": ["lines", "cashCountMinor", "confirmation"],
    "approve-opening": ["openingId", "confirmation"], activate: ["openingId", "confirmation"], pause: ["reason"], resume: ["reason"] };
  if (Object.keys(body).some(k => !["action", "requestId", ...allowed[body.action]].includes(k)) || !id(body.requestId) || body.requestId.length < 12) fail("Demande invalide.", "invalid-argument", 400);
  const fingerprint = hash(body), schoolId = caller.schoolId;
  return db.runTransaction(async tx => {
    const test = await readAllocationTestScope(db, tx, schoolId, now);
    if (!test) fail("Activation interdite hors périmètre fictif enregistré.", "test-scope-required", 403);
    const user = (await tx.get(db.doc(`users/${caller.uid}`))).data();
    if (!active(user) || !["admin", "school_admin"].includes(user.role) || user.schoolId !== schoolId) fail("Compte non autorisé.", "permission-denied", 403);
    const yearId = test.school.activeSchoolYearId;
    const year = (await tx.get(db.doc(`schoolYears/${yearId}`))).data();
    if (!year || year.schoolId !== schoolId || year.status !== "active") fail("Année inactive.");
    const currency = year.currency ?? test.school.currency;
    if (!["USD", "CDF"].includes(currency)) fail("Devise invalide.");
    const receiptRef = db.doc(`feeAllocationRequests/lifecycle_${hash([caller.uid, schoolId, body.requestId])}`);
    const receipt = (await tx.get(receiptRef)).data();
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) fail("Clé déjà utilisée avec un autre contenu.");
      return { ...receipt.result, idempotent: true };
    }
    const stateRef = db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`);
    const state = (await tx.get(stateRef)).data();
    const configured = await tx.get(db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).limit(51));
    if (configured.docs.length > 50) fail("Trop de configurations pour une activation atomique.");
    const versions = await Promise.all(configured.docs.filter(d => d.data().currentVersionId).map(async d => {
      const v = (await tx.get(db.doc(`feeAllocationVersions/${d.data().currentVersionId}`))).data();
      if (!v || v.schoolId !== schoolId || v.schoolYearId !== yearId || v.currency !== currency || v.status !== "published") fail("Version publiée non valide.");
      return v;
    }));
    const rubrics = new Map();
    for (const v of versions) for (const r of validateFeeAllocationRubrics(v.rubrics, v.feeAmountMinor).rubrics) {
      if (rubrics.has(r.id) && rubrics.get(r.id).name !== r.name) fail("Identité de rubrique incohérente.");
      rubrics.set(r.id, { id: r.id, name: r.name, active: true });
    }
    if (rubrics.size > 40) fail("Plus de 40 rubriques distinctes.");
    const configurationFingerprint = hash(versions.map(v => hash(v)).sort());
    const result = { operational: false, testOnly: true, action: body.action };
    if (body.action === "publish-configuration") {
      if (["ACTIVE", "PAUSED"].includes(state?.status)) fail("Publication interdite après activation sans nouveau rapprochement.");
      if (!id(body.versionId)) fail("Version invalide.", "invalid-argument", 400);
      const versionRef = db.doc(`feeAllocationVersions/${body.versionId}`), version = (await tx.get(versionRef)).data();
      if (!version || version.schoolId !== schoolId || version.schoolYearId !== yearId || version.currency !== currency || version.status !== "prepared") fail("Version préparée introuvable.");
      const configRef = db.doc(`feeAllocationConfigs/${version.configId}`), config = (await tx.get(configRef)).data();
      const fee = (await tx.get(db.doc(`feeTypes/${version.feeTypeId}`))).data();
      if (!config || config.schoolId !== schoolId || config.feeTypeId !== version.feeTypeId || config.draftRevision !== version.version
        || !fee || fee.schoolId !== schoolId || fee.schoolYearId !== yearId || toMoneyMinor(fee.amount) !== version.feeAmountMinor
        || fee.className !== version.className || (fee.classOptionKey ?? null) !== (version.classOptionKey ?? null)) fail("Tarif ou brouillon modifié depuis préparation.");
      const checked = validateFeeAllocationRubrics(version.rubrics, version.feeAmountMinor);
      // Firestore canonicalizes map key order; compare typed fields, not JSON order.
      if (!Array.isArray(version.shares) || checked.shares.length !== version.shares.length
        || checked.shares.some((share, index) => share.rubricId !== version.shares[index]?.rubricId
          || share.amountMinor !== version.shares[index]?.amountMinor
          || Object.keys(version.shares[index]).some(key => !["rubricId", "amountMinor"].includes(key)))) fail("Répartition préparée incohérente.");
      const oldRef = config.currentVersionId ? db.doc(`feeAllocationVersions/${config.currentVersionId}`) : null;
      if (oldRef) await tx.get(oldRef);
      tx.update(versionRef, { status: "published", effectiveFrom: now, publishedBy: caller.uid });
      tx.update(configRef, { currentVersionId: version.id });
      if (oldRef) tx.update(oldRef, { status: "superseded" });
      tx.set(db.doc(`feeAllocationFeeGuards/${version.feeTypeId}`), { schoolId, schoolYearId: yearId, configId: config.id, versionId: version.id });
      result.versionId = version.id;
    } else if (["prepare-opening", "approve-opening", "activate"].includes(body.action)) {
      if (["ACTIVE", "PAUSED"].includes(state?.status)) fail("Périmètre déjà activé.");
      if (!rubrics.size) fail("Une configuration publiée est indispensable.");
      const inventory = await openingInventory(db, tx, schoolId, yearId, currency);
      const lockRef = db.doc(`financialCashLocks/${createCashLock(schoolId, yearId, currency)}`);
      await tx.get(lockRef);
      if (body.action === "prepare-opening") {
        if (body.confirmation !== "RAPPROCHER LA CAISSE" || !minor(body.cashCountMinor) || body.cashCountMinor !== inventory.cashAvailableMinor) fail("Écart de caisse non résolu.");
        if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 41
          || body.lines.some(l => !l || Object.keys(l).some(k => !["rubricId", "amountMinor"].includes(k)) || !minor(l.amountMinor) || l.rubricId !== "UNALLOCATED" && !rubrics.has(l.rubricId))
          || new Set(body.lines.map(l => l.rubricId)).size !== body.lines.length
          || sum(body.lines.map(l => l.amountMinor)) !== inventory.schoolAvailableMinor) fail("L'ouverture doit expliquer exactement les fonds scolaires justifiés.");
        const openingId = `opening_${hash([schoolId, body.requestId])}`;
        tx.create(db.doc(`feeAllocationOpeningAudits/${openingId}`), { id: openingId, schoolId, schoolYearId: yearId, currency,
          fixtureId: test.school.fixtureId, cutoffAt: now, status: "proposed", lines: body.lines, configurationFingerprint,
          ...inventory, cashCountMinor: body.cashCountMinor, proposedBy: caller.uid, proposedAt: now });
        result.openingId = openingId;
      } else {
        if (!id(body.openingId)) fail("Rapprochement invalide.");
        const ref = db.doc(`feeAllocationOpeningAudits/${body.openingId}`), proposal = (await tx.get(ref)).data();
        if (!proposal || proposal.schoolId !== schoolId || proposal.schoolYearId !== yearId || proposal.currency !== currency
          || proposal.fixtureId !== test.school.fixtureId || proposal.fingerprint !== inventory.fingerprint
          || proposal.configurationFingerprint !== configurationFingerprint || proposal.cashCountMinor !== inventory.cashAvailableMinor) fail("Pièces ou configurations modifiées : refaire le rapprochement.");
        if (body.action === "approve-opening") {
          if (body.confirmation !== "APPROUVER LE RAPPROCHEMENT" || proposal.status !== "proposed") fail("Approbation explicite requise.");
          tx.update(ref, { status: "approved", approvedBy: caller.uid, approvedAt: now });
        } else {
          if (body.confirmation !== "ACTIVER LA REPARTITION FICTIVE" || proposal.status !== "approved") fail("Rapprochement approuvé requis.");
          const balanceRows = await Promise.all([...rubrics.keys(), "UNALLOCATED"].map(async rubricId => {
            const balanceRef = db.doc(`feeAllocationBalances/${allocationBalanceId(schoolId, yearId, currency, rubricId)}`);
            if ((await tx.get(balanceRef)).exists) fail("Solde déjà présent : rapprochement nécessaire.");
            return { balanceRef, rubricId, amount: proposal.lines.find(l => l.rubricId === rubricId)?.amountMinor ?? 0 };
          }));
          const movementId = `opening_${hash([schoolId, yearId, currency])}`;
          if ((await tx.get(db.doc(`feeAllocationMovements/${movementId}`))).exists) fail("Ouverture déjà comptabilisée.");
          tx.create(db.doc(`feeAllocationMovements/${movementId}`), { id: movementId, schoolId, collectionSchoolYearId: yearId,
            currency, sourceType: "opening", sourceId: proposal.id, sourceRevision: body.requestId, type: "opening", postedAt: now,
            amountMinor: inventory.schoolAvailableMinor, lines: proposal.lines, actorId: caller.uid, testOnly: true });
          balanceRows.forEach(({ balanceRef, rubricId, amount }) => tx.create(balanceRef, { schoolId, collectionSchoolYearId: yearId,
            currency, rubricId, openingMinor: amount, receivedMinor: 0, spentMinor: 0, reservedMinor: 0, availableMinor: amount, operational: true, updatedAt: now }));
          tx.set(stateRef, { schoolId, schoolYearId: yearId, currency, status: "ACTIVE", fixtureId: test.school.fixtureId,
            openingId: proposal.id, cutoffAt: now, activatedAt: now, activatedBy: caller.uid, rubrics: [...rubrics.values()], configurationFingerprint });
          tx.update(ref, { status: "activated", activatedAt: now });
        }
        result.openingId = proposal.id;
      }
      tx.set(lockRef, { schoolId, schoolYearId: yearId, currency, updatedAt: now }, { merge: true });
    } else {
      const expected = body.action === "pause" ? "ACTIVE" : "PAUSED";
      if (state?.status !== expected || state.fixtureId !== test.school.fixtureId || typeof body.reason !== "string" || body.reason.trim().length < 5 || body.reason.length > 500) fail("État ou motif de pause/reprise invalide.");
      tx.update(stateRef, { status: body.action === "pause" ? "PAUSED" : "ACTIVE", updatedAt: now, updatedBy: caller.uid });
    }
    const auditId = `allocation_${hash([schoolId, body.requestId, caller.uid])}`;
    tx.create(db.doc(`auditLogs/${auditId}`), { id: auditId, schoolId, schoolYearId: yearId, action: `fee-allocation.${body.action}`,
      actorId: caller.uid, createdAt: now, reason: body.reason ?? null, requestFingerprint: fingerprint, testOnly: true });
    tx.create(receiptRef, { schoolId, fingerprint, result, createdAt: now });
    return { ...result, idempotent: false };
  });
}

// Exact same cash serialization key as protectCashMutation; do not invent a second cash lock.
import { createHash } from "node:crypto";
const createCashLock = (school, year, currency) => createHash("sha256").update(`${school}:${year}:${currency}`).digest("hex");

export async function getAllocationSpendOptions({ db, caller, body, now = new Date().toISOString() }) {
  const { school, schoolId } = await readFeeAllocationScope(db, caller, body.schoolId ?? caller.schoolId);
  const { yearId, currency } = await readFeeAllocationYear(db, schoolId, school, body.schoolYearId, false);
  const test = await readAllocationTestScope(db, null, schoolId, now);
  if (!test) return { operational: false, required: false, rubrics: [] };
  const state = (await db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`).get()).data();
  if (!state || !["ACTIVE", "PAUSED"].includes(state.status)) return { operational: false, required: false, rubrics: [] };
  return { operational: false, required: true, paused: state.status === "PAUSED", currency,
    rubrics: [...state.rubrics.filter(r => r.active !== false), { id: "UNALLOCATED", name: "Non affecté", active: true }] };
}
