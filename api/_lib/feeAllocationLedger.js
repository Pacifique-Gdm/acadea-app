import { allocationSupportedProject, readOperationalAllocation, allocationFail as fail, allocationMinor as minor, allocationHash } from "./feeAllocationRuntime.js";
import { FieldPath } from 'firebase-admin/firestore';
import { readAllocationRevision } from './feeAllocationRevision.js';

/** Consistent, bounded read model, never expose source snapshots or student IDs. */
export async function readFeeAllocationLedger({ db, schoolId, schoolYearId, currency, page = 0, fingerprint, cursor, now = new Date().toISOString() }) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 0 && (!fingerprint || typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(cursor)) || page === 0 && cursor) fail("Page de registre sans preuve de continuité.", "invalid-argument", 400);
  if (!allocationSupportedProject(db)) return null;
  let documentReads = 0, attempts = 0;
  return db.runTransaction(async native => {
    attempts++;
    const transaction = { get: async ref => { const snapshot = await native.get(ref); documentReads += snapshot.docs ? Math.max(1, snapshot.docs.length) : 1; return snapshot; } };
    const state = await readOperationalAllocation({ db, transaction, schoolId, schoolYearId, currency, now });
    if (!state) return null;
    const revision = await readAllocationRevision(db, transaction, schoolId, schoolYearId);
    let query = db.collection("feeAllocationMovements").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId).where('currency', '==', currency).orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(cursor);
    const [movements, balances] = await Promise.all([
      transaction.get(query.limit(101)),
      transaction.get(db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId).limit(83)),
    ]);
    if (balances.docs.length > 82) fail("Nombre de soldes incohérent avec les rubriques autorisées.");
    const rows = movements.docs.slice(0, 100).map(d => ({ ...d.data(), id: d.id }));
    for (const m of rows) {
      if (!m.postedAt || !Number.isFinite(Date.parse(m.postedAt)) || !Array.isArray(m.lines) || !["payment", "expense", "opening"].includes(m.sourceType)
        || !Number.isSafeInteger(m.amountMinor) || new Set(m.lines.map(l => l.rubricId)).size !== m.lines.length
        || m.lines.some(l => !Number.isSafeInteger(l.amountMinor)) || m.lines.reduce((n, l) => n + l.amountMinor, 0) !== m.amountMinor) fail("Mouvement incohérent ; export bloqué.");
    }
    const relevant = balances.docs.map(d => d.data()).filter(b => b.currency === currency);
    for (const b of relevant) {
      if (![b.openingMinor ?? 0, b.receivedMinor, b.spentMinor, b.reservedMinor].every(minor)
        || b.availableMinor !== (b.openingMinor ?? 0) + b.receivedMinor - b.spentMinor - b.reservedMinor) fail("Écart registre/solde ; consultation financière bloquée.");
    }
    if (rows.some(m => m.lines.some(l => !relevant.some(b => b.rubricId === l.rubricId)))) fail("Solde manquant.");
    const safeRows = rows.map(m => ({ id: m.id, sourceType: m.sourceType, type: m.type, amountMinor: m.amountMinor, lines: m.lines,
        feeTypeId: m.feeTypeId ?? null, className: m.className ?? null, classOptionKey: m.classOptionKey ?? null,
        originSchoolYearId: m.originSchoolYearId ?? schoolYearId, postedAt: m.postedAt }));
    const digest = allocationHash([state, revision, relevant]);
    if (fingerprint && fingerprint !== digest) fail("Le registre a changé pendant sa lecture : actualisez la consultation complète.");
    const bounded = []; let size = 0;
    for (const row of safeRows) {
      const bytes = Buffer.byteLength(JSON.stringify(row), "utf8");
      if (bytes > 200_000) fail("Mouvement trop volumineux ou malformé.");
      if (size + bytes > 500_000) break;
      bounded.push(row); size += bytes;
    }
    const hasNext = movements.docs.length > bounded.length;
    if (hasNext && !bounded.length) fail('Page de registre trop volumineuse.');
    return { status: state.status, cutoffAt: state.cutoffAt, testOnly: state.testOnly, rubrics: [...state.rubrics, { id: "UNALLOCATED", name: "Non affecté" }],
      movements: bounded, pagination: { page, hasNext, nextCursor: bounded.at(-1)?.id ?? null, fingerprint: digest },
      metrics: { movementReads: movements.docs.length, movementLimit: 101, transactionDocumentReads: documentReads, transactionAttempts: attempts },
      balances: relevant.map(b => ({ rubricId: b.rubricId, openingMinor: b.openingMinor ?? 0, receivedMinor: b.receivedMinor, spentMinor: b.spentMinor, reservedMinor: b.reservedMinor, availableMinor: b.availableMinor })) };
  });
}
