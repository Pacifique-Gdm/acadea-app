import { FieldPath } from 'firebase-admin/firestore';
import { allocationHash as hash, allocationFail as fail, allocationIdentifier as id, readAllocationEligibility } from './feeAllocationRuntime.js';
import { readAllocationRevision, readAllocationRevisionDetail, allocationRunRef, allocationScopeStateRef, evidenceRevisionRef } from './feeAllocationRevision.js';
import { readFeeAllocationScope } from './feeAllocationPhase1.js';
import { toMoneyMinor } from './money.js';
import { validateFeeAllocationRubrics } from './feeAllocationMath.js';

export const RECONCILIATION_BATCH = 100;
export const reconciliationActions = new Set(['start-reconciliation', 'advance-reconciliation', 'justify-history']);
const sources = ['payments', 'expenses', 'cashInflows', 'feeAllocationConfigs'];
const proofRef = (db, collection, sourceId) => db.doc(`feeAllocationHistoricalProofs/${hash([collection, sourceId])}`);
const safeAdd = (a, b) => { const n = a + b; if (!Number.isSafeInteger(n) || n < 0) fail('Total hors limites.'); return n; };
export const runPublic = run => run ? { id: run.id, status: run.status, pageCount: run.pageCount, scanned: run.scanned,
  evidenceCount: run.evidenceCount, blockedCount: run.blockedCount, cutoffAt: run.cutoffAt, sequence: run.sequence,
  sourceIndex: run.sourceIndex, reason: run.reason ?? null, deficitMinor: run.deficitMinor ?? 0 } : null;

export async function assertRunCurrent(db, tx, run, schoolId, yearId, currency) {
  if (!run || run.schoolId !== schoolId || run.schoolYearId !== yearId || run.currency !== currency) fail('Rapprochement hors périmètre.');
  const revision = await readAllocationRevision(db, tx, schoolId, yearId);
  if (revision !== run.revision) fail('Les pièces ont changé : refaire le rapprochement.', 'allocation-stale');
}

/** Each call commits one bounded page and its cursor atomically. The caller's
 * expected sequence makes a lost reply/retry a read, never a second addition. */
export async function manageAllocationReconciliation({ db, caller, body, now = new Date().toISOString(), fileExists = null }) {
  if (!['admin', 'school_admin'].includes(caller.role)) fail('Rapprochement réservé à l’Administrateur.', 'permission-denied', 403);
  await readFeeAllocationScope(db, caller, caller.schoolId);
  const fields = { 'start-reconciliation': ['requestId'], 'advance-reconciliation': ['runId', 'sequence'],
    'justify-history': ['requestId', 'collection', 'sourceId', 'evidenceType', 'evidenceId', 'reason', 'photoPath', 'currency'] };
  if (!fields[body.action] || Object.keys(body).some(k => !['action', ...fields[body.action]].includes(k))) fail('Demande invalide.', 'invalid-argument', 400);
  if (body.action === 'justify-history' && body.photoPath !== undefined) {
    // Lot « 3 étapes », point 1 : photo facultative, déjà envoyée par l'Administrateur dans son propre dossier.
    const prefix = `fee-allocation-proofs/${caller.schoolId}/${caller.uid}/`;
    if (body.evidenceType !== 'declaration' || typeof body.photoPath !== 'string' || !body.photoPath.startsWith(prefix)
      || !/^[A-Za-z0-9_-]{8,80}\.(jpg|png|webp)$/.test(body.photoPath.slice(prefix.length))) fail('Photo invalide.', 'invalid-argument', 400);
    if (typeof fileExists !== 'function' || !(await fileExists(body.photoPath))) fail('Photo introuvable : envoyez-la de nouveau.', 'invalid-argument', 400);
  }
  let documentReads = 0, attempts = 0;
  return db.runTransaction(async native => {
    attempts++;
    const tx = { get: async ref => { const snapshot = await native.get(ref); documentReads += snapshot.docs ? Math.max(1, snapshot.docs.length) : 1; return snapshot; },
      create: (...args) => native.create(...args), set: (...args) => native.set(...args), update: (...args) => native.update(...args) };
    const scope = await readAllocationEligibility(db, tx, caller.schoolId, now);
    const profile = (await tx.get(db.doc(`users/${caller.uid}`))).data();
    if (!profile || profile.active === false || ['inactive', 'disabled', 'suspended', 'deleted', 'deleting'].includes(profile.status)
      || !['admin', 'school_admin'].includes(profile.role) || profile.schoolId !== caller.schoolId) fail('Compte non autorisé.', 'permission-denied', 403);
    const schoolId = caller.schoolId, schoolYearId = scope.school.activeSchoolYearId, currency = scope.currency;
    const stateRef = allocationScopeStateRef(db, schoolId, schoolYearId, currency), state = (await tx.get(stateRef)).data();
    if (['ACTIVE', 'PAUSED'].includes(state?.status)) fail('Rapprochement interdit après activation.');
    if (body.action === 'justify-history') return justify(db, tx, { schoolId, schoolYearId, caller, body, now });
    if (body.action === 'start-reconciliation') {
      if (!id(body.requestId) || body.requestId.length < 12) fail('Identifiant de demande invalide.', 'invalid-argument', 400);
      const runId = `run_${hash([schoolId, schoolYearId, currency, caller.uid, body.requestId])}`;
      const ref = allocationRunRef(db, runId), prior = (await tx.get(ref)).data();
      if (prior) return { operational: false, run: runPublic(prior), idempotent: true };
      const detail = await readAllocationRevisionDetail(db, tx, schoolId, schoolYearId);
      // Lot « 3 étapes » : marques gardées pour reconnaître ensuite les seuls encaissements de la mise en route.
      const run = { id: runId, schoolId, schoolYearId, currency, revision: detail.revision, lockRevisions: detail.locks, evidenceStamp: detail.evidence,
        cutoffAt: now, createdBy: caller.uid,
        status: 'RUNNING', sequence: 0, sourceIndex: 0, cursor: null, pageCount: 0, scanned: 0,
        evidenceCount: 0, blockedCount: 0, receivedMinor: 0, spentMinor: 0, otherMinor: 0, chain: hash([]),
        rubrics: [], configurationChain: hash([]), configurationCount: 0 };
      tx.create(ref, run);
      tx.set(stateRef, { ...(state ?? {}), schoolId, schoolYearId, currency, status: 'EN_PREPARATION', reconciliationRunId: runId }, { merge: true });
      return { operational: false, run: runPublic(run), idempotent: false };
    }
    if (!id(body.runId) || !Number.isSafeInteger(body.sequence) || body.sequence < 0) fail('Reprise invalide.', 'invalid-argument', 400);
    const ref = allocationRunRef(db, body.runId), run = (await tx.get(ref)).data();
    if (state?.reconciliationRunId !== body.runId) fail('Ce rapprochement a été remplacé : actualisez la consultation.', 'allocation-stale');
    await assertRunCurrent(db, tx, run, schoolId, schoolYearId, currency);
    if (body.sequence < run.sequence || run.status !== 'RUNNING') return { operational: false, run: runPublic(run), idempotent: true };
    if (body.sequence !== run.sequence) fail('Étape de reprise incorrecte.');
    const collection = sources[run.sourceIndex];
    let query = db.collection(collection).where('schoolId', '==', schoolId).orderBy(FieldPath.documentId());
    if (run.cursor) query = query.startAfter(run.cursor);
    const page = await tx.get(query.limit(RECONCILIATION_BATCH));
    const rows = [], bindings = [], next = { ...run, rubrics: [...run.rubrics] };
    for (const doc of page.docs) {
      if (run.cursor && doc.id <= run.cursor) fail('Curseur répété.');
      const data = doc.data(); next.scanned++;
      if ((data.collectionSchoolYearId ?? data.schoolYearId) !== schoolYearId) continue;
      const sourceDigest = hash(data);
      if (collection === 'feeAllocationConfigs') {
        if (!data.currentVersionId) continue;
        const version = (await tx.get(db.doc(`feeAllocationVersions/${data.currentVersionId}`))).data();
        if (!version || version.schoolId !== schoolId || version.schoolYearId !== schoolYearId || version.currency !== currency
          || version.status !== 'published' || version.configId !== doc.id || version.feeTypeId !== data.feeTypeId) fail('Version publiée non vérifiée.');
        for (const r of validateFeeAllocationRubrics(version.rubrics, version.feeAmountMinor).rubrics) {
          const prior = next.rubrics.find(item => item.id === r.id);
          if (prior && prior.name !== r.name) fail('Identité de rubrique incohérente.');
          if (!prior) next.rubrics.push({ id: r.id, name: r.name, active: true });
        }
        if (next.rubrics.length > 40) fail('Plus de 40 rubriques distinctes.');
        next.configurationCount++;
        next.configurationChain = hash([next.configurationChain, sourceDigest, hash(version)]);
        bindings.push({ schoolId, schoolYearId, currency, runId: run.id, feeTypeId: data.feeTypeId, versionId: version.id });
        rows.push({ collection, id: doc.id, digest: sourceDigest, reason: null, versionId: version.id });
        continue;
      }
      const proof = (await tx.get(proofRef(db, collection, doc.id))).data();
      let validProof = proof?.decision === 'accepted' && proof.sourceDigest === sourceDigest
        && proof.schoolId === schoolId && proof.schoolYearId === schoolYearId;
      if (validProof) {
        const evidence = (await tx.get(db.doc(proof.evidencePath))).data();
        validProof = !!evidence && hash(evidence) === proof.evidenceDigest;
      }
      const resolved = validProof ? { ...data, currency: proof.currency, createdAt: proof.recordedAt } : data;
      let reason = null, amountMinor = null;
      try { amountMinor = toMoneyMinor(data.amount); } catch { reason = 'Montant non vérifiable'; }
      if (!Number.isFinite(Date.parse(resolved.createdAt)) || !['USD', 'CDF'].includes(resolved.currency)) reason = 'Date ou devise non justifiée';
      if (!validProof && (['payments', 'cashInflows'].includes(collection) && (data.provenance !== 'financial-api' || !data.clientRequestIdHash)
        || collection === 'expenses' && !['financial-api', 'personnel-payroll'].includes(data.provenance))) reason = 'Provenance serveur non justifiée';
      if (!reason && resolved.currency !== currency) continue;
      if (reason) next.blockedCount++;
      else {
        const field = collection === 'payments' ? 'receivedMinor' : collection === 'expenses' ? 'spentMinor' : 'otherMinor';
        next[field] = safeAdd(next[field], amountMinor); next.evidenceCount++;
      }
      rows.push({ collection, id: doc.id, digest: sourceDigest, amountMinor, currency: resolved.currency ?? null,
        createdAt: resolved.createdAt ?? null, reason, proofId: validProof ? proof.id : null });
    }
    next.sequence++; next.pageCount++; next.cursor = page.docs.at(-1)?.id ?? run.cursor;
    if (page.docs.length < RECONCILIATION_BATCH) { next.sourceIndex++; next.cursor = null; }
    next.chain = hash([run.chain, collection, rows, next.cursor, next.sourceIndex]);
    if (next.sourceIndex === sources.length) {
      // Lot « 3 étapes », point 2 : des dépenses supérieures aux encaissements ne bloquent plus.
      // La différence ira en négatif dans « Non affecté », avec un motif obligatoire au solde de départ.
      next.status = next.blockedCount ? 'BLOCKED' : 'COMPLETE';
      next.reason = next.blockedCount ? 'Écritures historiques à justifier.' : null;
      next.deficitMinor = Math.max(0, next.spentMinor - next.receivedMinor);
      next.completedAt = now;
    }
    tx.create(db.doc(`feeAllocationReconciliationRuns/${run.id}/pages/${String(run.pageCount).padStart(8, '0')}`), { schoolId, schoolYearId, currency, rows, chain: next.chain });
    for (const binding of bindings) tx.create(db.doc(`feeAllocationReconciliationRuns/${run.id}/versions/${binding.feeTypeId}`), binding);
    tx.update(ref, next);
    return { operational: false, run: runPublic(next), idempotent: false, metrics: { sourceReads: page.docs.length, sourceLimit: RECONCILIATION_BATCH,
      transactionDocumentReads: documentReads, transactionAttempts: attempts } };
  });
}

/** An uploaded file or an administrator's assertion is not proof. Only an
 * independently persisted server receipt/payroll relation can be accepted. */
async function justify(db, tx, { schoolId, schoolYearId, caller, body, now }) {
  const declaration = body.evidenceType === 'declaration';
  if (!id(body.requestId) || body.requestId.length < 12 || !sources.slice(0, 3).includes(body.collection) || !id(body.sourceId)
    || !(declaration ? body.evidenceId === undefined : ['financialIdempotency', 'personnelPayments'].includes(body.evidenceType) && id(body.evidenceId))
    || (body.currency !== undefined && (!declaration || !['USD', 'CDF'].includes(body.currency)))
    || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 500) fail('Justification invalide.', 'invalid-argument', 400);
  if (declaration) return declare(db, tx, { schoolId, schoolYearId, caller, body, now });
  const ref = proofRef(db, body.collection, body.sourceId), source = (await tx.get(db.doc(`${body.collection}/${body.sourceId}`))).data();
  if (!source || source.schoolId !== schoolId || (source.collectionSchoolYearId ?? source.schoolYearId) !== schoolYearId) fail('Écriture étrangère.', 'permission-denied', 403);
  const evidence = (await tx.get(db.doc(`${body.evidenceType}/${body.evidenceId}`))).data();
  const claimRef = db.doc(`feeAllocationEvidenceClaims/${hash([body.evidenceType, body.evidenceId])}`), claim = (await tx.get(claimRef)).data();
  const prior = (await tx.get(ref)).data();
  const auditRef = db.doc(`feeAllocationHistoricalDecisions/${hash([caller.uid, body.requestId])}`), priorDecision = (await tx.get(auditRef)).data();
  const requestHash = hash(body);
  if (priorDecision) {
    if (priorDecision.requestHash !== requestHash) fail('Demande déjà utilisée.');
    return { operational: false, decision: priorDecision.decision, reason: priorDecision.reason, idempotent: true };
  }
  const linked = body.evidenceType === 'financialIdempotency'
    ? evidence?.result?.[body.collection === 'payments' ? 'payment' : body.collection === 'expenses' ? 'expense' : 'cashInflow']
    : evidence && body.collection === 'expenses' && evidence.expenseId === body.sourceId
      ? { ...evidence, id: evidence.expenseId, amount: evidence.netPaid } : null;
  const matches = linked && evidence.schoolId === schoolId && linked.schoolId === schoolId && linked.id === body.sourceId
    && (linked.collectionSchoolYearId ?? linked.schoolYearId) === schoolYearId && linked.amount === source.amount
    && ['USD', 'CDF'].includes(linked.currency) && Number.isFinite(Date.parse(linked.createdAt))
    && (!['USD', 'CDF'].includes(source.currency) || source.currency === linked.currency)
    && (body.collection !== 'payments' || linked.studentId === source.studentId && linked.feeTypeId === source.feeTypeId)
    && (body.evidenceType !== 'personnelPayments' || source.personnelPaymentId === body.evidenceId)
    && (!claim || claim.sourcePath === `${body.collection}/${body.sourceId}`);
  const decision = matches ? 'accepted' : 'rejected';
  const reason = matches ? body.reason.trim() : 'Pièce serveur absente, non concordante ou déjà utilisée ; ouverture bloquée.';
  tx.create(auditRef, { schoolId, schoolYearId, sourcePath: `${body.collection}/${body.sourceId}`, sourceDigest: hash(source),
    evidencePath: `${body.evidenceType}/${body.evidenceId}`, evidenceDigest: evidence ? hash(evidence) : null,
    actorId: caller.uid, decidedAt: now, decision, reason, submittedReason: body.reason.trim(), requestHash });
  if (matches) {
    tx.set(ref, { id: ref.id, schoolId, schoolYearId, sourceDigest: hash(source), evidenceDigest: hash(evidence),
      evidencePath: `${body.evidenceType}/${body.evidenceId}`, currency: linked.currency, recordedAt: linked.createdAt,
      actorId: caller.uid, decidedAt: now, decision, reason, priorDecisionId: prior?.decisionId ?? null, decisionId: auditRef.id });
    if (!claim) tx.create(claimRef, { schoolId, sourcePath: `${body.collection}/${body.sourceId}`, proofId: ref.id });
    tx.set(evidenceRevisionRef(db, schoolId, schoolYearId), { schoolId, schoolYearId, revision: hash([requestHash, now]) });
  }
  return { operational: false, decision, reason, idempotent: false };
}

const sortedKeys = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)));

/** Lot « 3 étapes », point 1 : une ancienne écriture sans preuve serveur peut être justifiée par l'Administrateur
 * avec un motif écrit (et une photo facultative). La déclaration est conservée et reste dans l'historique ;
 * elle ne change ni le montant ni l'écriture. Un montant illisible ou une devise inconnue restent refusés. */
async function declare(db, tx, { schoolId, schoolYearId, caller, body, now }) {
  const ref = proofRef(db, body.collection, body.sourceId), source = (await tx.get(db.doc(`${body.collection}/${body.sourceId}`))).data();
  if (!source || source.schoolId !== schoolId || (source.collectionSchoolYearId ?? source.schoolYearId) !== schoolYearId) fail('Écriture étrangère.', 'permission-denied', 403);
  const prior = (await tx.get(ref)).data();
  const auditRef = db.doc(`feeAllocationHistoricalDecisions/${hash([caller.uid, body.requestId])}`), priorDecision = (await tx.get(auditRef)).data();
  const requestHash = hash(body);
  if (priorDecision) {
    if (priorDecision.requestHash !== requestHash) fail('Demande déjà utilisée.');
    return { operational: false, decision: priorDecision.decision, reason: priorDecision.reason, idempotent: true };
  }
  let readable = true;
  try { toMoneyMinor(source.amount); } catch { readable = false; }
  const knownCurrency = ['USD', 'CDF'].includes(source.currency) ? source.currency : null;
  const currency = knownCurrency ?? body.currency ?? null;
  const reason = body.reason.trim(), photoPath = body.photoPath ?? null, sourcePath = `${body.collection}/${body.sourceId}`;
  if (!readable || !currency || (knownCurrency && body.currency && body.currency !== knownCurrency)) {
    const refused = !readable ? 'Montant illisible : cette écriture doit être corrigée avant la répartition.' : !currency ? 'Devise inconnue : choisissez la devise de cette écriture.' : 'La devise choisie ne correspond pas à celle de l’écriture.';
    tx.create(auditRef, { schoolId, schoolYearId, sourcePath, sourceDigest: hash(source), evidencePath: null, evidenceDigest: null, kind: 'declaration',
      actorId: caller.uid, decidedAt: now, decision: 'rejected', reason: refused, submittedReason: reason, photoPath, requestHash });
    return { operational: false, decision: 'rejected', reason: refused, idempotent: false };
  }
  const recordedAt = Number.isFinite(Date.parse(source.createdAt)) ? source.createdAt : now;
  const declarationRef = db.doc(`feeAllocationHistoricalDeclarations/${auditRef.id}`);
  // Clés triées : l'empreinte relue plus tard par la vérification est la même.
  const evidence = sortedKeys({ id: auditRef.id, schoolId, schoolYearId, sourcePath, sourceDigest: hash(source), reason, photoPath, currency, recordedAt, declaredBy: caller.uid, declaredAt: now });
  tx.create(declarationRef, evidence);
  tx.create(auditRef, { schoolId, schoolYearId, sourcePath, sourceDigest: hash(source), evidencePath: declarationRef.path, evidenceDigest: hash(evidence), kind: 'declaration',
    actorId: caller.uid, decidedAt: now, decision: 'accepted', reason, submittedReason: reason, photoPath, requestHash });
  tx.set(ref, { id: ref.id, schoolId, schoolYearId, sourceDigest: hash(source), evidenceDigest: hash(evidence), evidencePath: declarationRef.path, kind: 'declaration',
    currency, recordedAt, actorId: caller.uid, decidedAt: now, decision: 'accepted', reason, photoPath, priorDecisionId: prior?.decisionId ?? null, decisionId: auditRef.id });
  tx.set(evidenceRevisionRef(db, schoolId, schoolYearId), { schoolId, schoolYearId, revision: hash([requestHash, now]) });
  return { operational: false, decision: 'accepted', reason, idempotent: false };
}
