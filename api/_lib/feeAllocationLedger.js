import { allocationSupportedProject, readOperationalAllocation, allocationFail as fail, allocationMinor as minor, allocationHash } from "./feeAllocationRuntime.js";
import { readAllocationPages } from "./feeAllocationPagination.js";

/** Consistent, bounded read model, never expose source snapshots or student IDs. */
export async function readFeeAllocationLedger({ db, schoolId, schoolYearId, currency, page = 0, fingerprint, now = new Date().toISOString() }) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 0 && !fingerprint) fail("Page de registre sans preuve de continuité.", "invalid-argument", 400);
  if (!allocationSupportedProject(db)) return null;
  return db.runTransaction(async transaction => {
    const state = await readOperationalAllocation({ db, transaction, schoolId, schoolYearId, currency, now });
    if (!state) return null;
    const [movements, balances] = await Promise.all([
      readAllocationPages(db.collection("feeAllocationMovements").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId), transaction),
      transaction.get(db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId).limit(83)),
    ]);
    if (balances.docs.length > 82) fail("Nombre de soldes incohérent avec les rubriques autorisées.");
    const rows = movements.docs.map(d => d.data()).filter(m => m.currency === currency);
    const sums = new Map();
    for (const m of rows) {
      if (!m.postedAt || !Number.isFinite(Date.parse(m.postedAt)) || !Array.isArray(m.lines) || !["payment", "expense", "opening"].includes(m.sourceType)
        || !Number.isSafeInteger(m.amountMinor) || new Set(m.lines.map(l => l.rubricId)).size !== m.lines.length
        || m.lines.some(l => !Number.isSafeInteger(l.amountMinor)) || m.lines.reduce((n, l) => n + l.amountMinor, 0) !== m.amountMinor) fail("Mouvement incohérent ; export bloqué.");
      for (const l of m.lines) {
        const next = (sums.get(l.rubricId) ?? 0) + l.amountMinor;
        if (!Number.isSafeInteger(next)) fail("Solde hors limites."); sums.set(l.rubricId, next);
      }
    }
    const relevant = balances.docs.map(d => d.data()).filter(b => b.currency === currency);
    for (const b of relevant) {
      if (![b.openingMinor ?? 0, b.receivedMinor, b.spentMinor, b.reservedMinor].every(minor)
        || (sums.get(b.rubricId) ?? 0) !== (b.openingMinor ?? 0) + b.receivedMinor - b.spentMinor
        || b.availableMinor !== (b.openingMinor ?? 0) + b.receivedMinor - b.spentMinor - b.reservedMinor) fail("Écart registre/solde ; consultation financière bloquée.");
    }
    if ([...sums.keys()].some(key => !relevant.some(b => b.rubricId === key))) fail("Solde manquant.");
    const safeRows = rows.map(m => ({ id: m.id, sourceType: m.sourceType, type: m.type, amountMinor: m.amountMinor, lines: m.lines,
        feeTypeId: m.feeTypeId ?? null, className: m.className ?? null, classOptionKey: m.classOptionKey ?? null,
        originSchoolYearId: m.originSchoolYearId ?? schoolYearId, postedAt: m.postedAt }));
    const digest = allocationHash([state, safeRows, relevant]);
    if (fingerprint && fingerprint !== digest) fail("Le registre a changé pendant sa lecture : actualisez la consultation complète.");
    const pages = [[]]; let size = 0;
    for (const row of safeRows) {
      const bytes = Buffer.byteLength(JSON.stringify(row), "utf8");
      if (bytes > 200_000) fail("Mouvement trop volumineux ou malformé.");
      if (pages.at(-1).length >= 200 || size + bytes > 500_000) { pages.push([]); size = 0; }
      pages.at(-1).push(row); size += bytes;
    }
    if (page >= pages.length) fail("Page de registre hors limites.", "invalid-argument", 400);
    return { status: state.status, cutoffAt: state.cutoffAt, testOnly: state.testOnly, rubrics: [...state.rubrics, { id: "UNALLOCATED", name: "Non affecté" }],
      movements: pages[page], pagination: { page, pages: pages.length, total: safeRows.length, fingerprint: digest },
      balances: relevant.map(b => ({ rubricId: b.rubricId, openingMinor: b.openingMinor ?? 0, receivedMinor: b.receivedMinor, spentMinor: b.spentMinor, reservedMinor: b.reservedMinor, availableMinor: b.availableMinor })) };
  });
}
