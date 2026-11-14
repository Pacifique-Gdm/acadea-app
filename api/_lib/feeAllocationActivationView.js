import { readFeeAllocationScope } from "./feeAllocationPhase1.js";
import { allocationRunRef, readAllocationRevision } from './feeAllocationRevision.js';
import { runPublic } from './feeAllocationReconciliation.js';
import { readAllocationPages } from "./feeAllocationPagination.js";
import { allocationHash as hash, allocationStateId, allocationFail as fail, readAllocationEligibility, readOperationalAllocation } from "./feeAllocationRuntime.js";
import { validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { FieldPath } from 'firebase-admin/firestore';
import { allocationIdentifier } from './feeAllocationRuntime.js';

const kinds = { payments: 'Paiement scolaire', expenses: 'Dépense', cashInflows: 'Autre entrée de caisse', feeAllocationConfigs: 'Configuration de répartition' };
const safeText = value => typeof value === 'string' ? value.slice(0, 120) : null;
async function presentEvidence(db, tx, row, schoolId, yearId) {
  const { digest, ...safe } = row;
  if (!Object.hasOwn(kinds, row.collection) || !allocationIdentifier(row.id)) fail('Pièce non reconnue.');
  const source = (await tx.get(db.doc(`${row.collection}/${row.id}`))).data();
  if (!source || source.schoolId !== schoolId || (source.collectionSchoolYearId ?? source.schoolYearId) !== yearId || hash(source) !== digest) fail('La pièce a changé : actualisez la vérification.', 'allocation-stale');
  return { ...safe, nature: row.collection === 'expenses' && (source.personnelPaymentId || source.provenance === 'personnel-payroll') ? 'Paiement de personnel' : kinds[row.collection],
    amountMinor: row.amountMinor ?? null, createdAt: safeText(row.createdAt),
    receiptNumber: safeText(source.receiptNumber), currency: ['USD', 'CDF'].includes(row.currency) ? row.currency : null };
}

/** Suggestions are not approvals. The existing justify-history mutation remains
 * the only authority for concordance, reuse protection and audit. */
async function proofCandidates(db, tx, body, schoolId, yearId) {
  const source = (await tx.get(db.doc(`${body.collection}/${body.sourceId}`))).data();
  if (!source || source.schoolId !== schoolId || (source.collectionSchoolYearId ?? source.schoolYearId) !== yearId) fail('Écriture étrangère.', 'permission-denied', 403);
  const candidates = [];
  const add = (type, id, evidence, linked) => {
    if (!linked || evidence.schoolId !== schoolId || linked.schoolId !== schoolId || linked.id !== body.sourceId
      || (linked.collectionSchoolYearId ?? linked.schoolYearId) !== yearId || linked.amount !== source.amount) return;
    candidates.push({ type, id, nature: type === 'personnelPayments' ? 'Paie liée' : 'Reçu serveur',
      amount: linked.amount, currency: ['USD', 'CDF'].includes(linked.currency) ? linked.currency : null,
      createdAt: safeText(linked.createdAt), receiptNumber: safeText(linked.receiptNumber) });
  };
  if (!body.cursor && body.collection === 'expenses' && allocationIdentifier(source.personnelPaymentId)) {
    const evidence = (await tx.get(db.doc(`personnelPayments/${source.personnelPaymentId}`))).data();
    if (evidence?.expenseId === body.sourceId) add('personnelPayments', source.personnelPaymentId, evidence, { ...evidence, id: evidence.expenseId, amount: evidence.netPaid });
  }
  let query = db.collection('financialIdempotency').where('schoolId', '==', schoolId).orderBy(FieldPath.documentId());
  if (body.cursor) query = query.startAfter(body.cursor);
  const page = await tx.get(query.limit(41));
  const field = { payments: 'payment', expenses: 'expense', cashInflows: 'cashInflow' }[body.collection];
  for (const doc of page.docs.slice(0, 40)) { const data = doc.data(); add('financialIdempotency', doc.id, data, data.result?.[field]); }
  return { operational: false, schoolId, candidates, nextCursor: page.docs.length > 40 ? page.docs[39].id : null };
}

/** Administrator-only evidence view. No write, no client-supplied school/year. */
export async function readAllocationActivation({ db, caller, body, now = new Date().toISOString() }) {
  if (!["admin", "school_admin"].includes(caller.role)) fail("Rapprochement réservé à l'Administrateur.", "permission-denied", 403);
  const proofs = body.action === 'get-history-proofs';
  const allowed = proofs ? ['action', 'collection', 'sourceId', 'cursor'] : ['action', 'page', 'fingerprint', 'blockedOnly'];
  if (Object.keys(body).some(k => !allowed.includes(k))
    || (proofs && (!['payments', 'expenses', 'cashInflows'].includes(body.collection) || !allocationIdentifier(body.sourceId) || (body.cursor !== undefined && !allocationIdentifier(body.cursor))))
    || (body.blockedOnly !== undefined && typeof body.blockedOnly !== 'boolean')
    || !Number.isSafeInteger(body.page ?? 0) || (body.page ?? 0) < 0) fail("Page de preuve invalide.", "invalid-argument", 400);
  await readFeeAllocationScope(db, caller, caller.schoolId);
  return db.runTransaction(async tx => {
    const scope = await readAllocationEligibility(db, tx, caller.schoolId, now);
    const profile = (await tx.get(db.doc(`users/${caller.uid}`))).data();
    if (!profile || profile.active === false || ["inactive", "disabled", "suspended", "deleting", "deleted"].includes(profile.status)
      || !["admin", "school_admin"].includes(profile.role) || profile.schoolId !== caller.schoolId) fail("Compte non autorisé.", "permission-denied", 403);
    const schoolId = caller.schoolId, yearId = scope.school.activeSchoolYearId, currency = scope.currency;
    if (proofs) return proofCandidates(db, tx, body, schoolId, yearId);
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
    const run = state?.reconciliationRunId ? (await tx.get(allocationRunRef(db, state.reconciliationRunId))).data() : null;
    if (run && (run.schoolId !== schoolId || run.schoolYearId !== yearId || run.currency !== currency)) fail('Rapprochement étranger.');
    const revision = await readAllocationRevision(db, tx, schoolId, yearId);
    const runStale = !!run && run.revision !== revision;
    const fingerprint = run ? hash([run.id, run.chain, run.revision]) : null;
    if (body.fingerprint && (body.fingerprint !== fingerprint || runStale)) fail("Les pièces ont changé : recommencez leur consultation.");
    const proposal = state?.lastOpeningId ? (await tx.get(db.doc(`feeAllocationOpeningAudits/${state.lastOpeningId}`))).data() : null;
    if (proposal && (proposal.schoolId !== schoolId || proposal.schoolYearId !== yearId || proposal.currency !== currency)) fail("Rapprochement étranger.");
    const stale = proposal && (runStale || proposal.fingerprint !== fingerprint || proposal.configurationFingerprint !== run?.configurationChain);
    let page = body.page ?? 0;
    if (run && page >= Math.max(1, run.pageCount)) fail('Page de preuve hors limites.', 'invalid-argument', 400);
    let rows = [];
    const pages = new Map();
    const getPage = async index => {
      if (!pages.has(index)) {
        const value = (await tx.get(db.doc(`feeAllocationReconciliationRuns/${run.id}/pages/${String(index).padStart(8, '0')}`))).data();
        if (!value || value.schoolId !== schoolId || value.schoolYearId !== yearId) fail('Page de preuve manquante.');
        pages.set(index, value);
      }
      return pages.get(index);
    };
    // Existing runs need no migration. Search at most 20 evidence pages per
    // request; the client continues this bounded lookup, not the user.
    for (let searched = 0; run?.pageCount && searched < 20; searched++) {
      const proofPage = await getPage(page);
      rows = body.blockedOnly ? proofPage.rows.filter(row => row.reason) : proofPage.rows;
      if (rows.length || !body.blockedOnly || page + 1 >= run.pageCount || searched === 19) break;
      page++;
    }
    // A known stale run must remain readable so the administrator can restart
    // verification. Never hydrate/present its old rows as verified evidence.
    const safeRows = runStale ? [] : await Promise.all(rows.map(row => presentEvidence(db, tx, row, schoolId, yearId)));
    // A bounded server lookup can identify the single blocker even when the
    // displayed page contains only verified payments. Counts always come from
    // the reconciliation run, never from this partial presentation lookup.
    let singleBlocker = null;
    if (run?.blockedCount === 1 && !runStale) {
      const visible = safeRows.find(row => row.reason);
      if (visible) singleBlocker = visible;
      else for (let index = 0; index < Math.min(run.pageCount, 20); index++) {
        const blocked = (await getPage(index)).rows.find(row => row.reason);
        if (blocked) { singleBlocker = await presentEvidence(db, tx, blocked, schoolId, yearId); break; }
      }
    }
    return { operational: false, schoolId, schoolYearId: yearId, currency, testOnly: scope.testOnly, status: "EN_PREPARATION", cutoffAt: now,
      rubrics: [...rubrics.values()], versions: versions.docs.map(d => d.data()).filter(v => ["prepared", "published"].includes(v.status))
        .map(v => ({ id: v.id, configId: v.configId, feeTypeId: v.feeTypeId, version: v.version, status: v.status })),
      reconciliation: run ? { ...runPublic(run), stale: runStale } : null,
      singleBlocker,
      evidencePage: { page, hasNext: page + 1 < (run?.pageCount ?? 0), rows: safeRows, fingerprint },
      opening: proposal ? { id: proposal.id, status: proposal.status, stale: !!stale, cutoffAt: proposal.cutoffAt,
        approvedByCurrentUser: proposal.approvedBy === caller.uid, lines: proposal.lines, cashCountMinor: proposal.cashCountMinor } : null,
      inventory: run?.status === 'COMPLETE' && !runStale ? { schoolAvailableMinor: run.receivedMinor - run.spentMinor,
        cashAvailableMinor: run.receivedMinor - run.spentMinor + run.otherMinor,
        fingerprint, evidenceCount: run.evidenceCount, page, hasNext: page + 1 < run.pageCount, evidence: safeRows.filter(row => row.collection !== 'feeAllocationConfigs') } : null };
  });
}
