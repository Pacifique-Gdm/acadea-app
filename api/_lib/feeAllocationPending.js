import { createHash } from "node:crypto";
import { prepareFeeAllocationReceipt } from "./feeAllocationReceipts.js";

/** Lot 27a (décision du propriétaire) : la répartition ne doit JAMAIS bloquer un paiement d'élève.
 * Si sa préparation échoue (données à rapprocher, version à vérifier, incident), le paiement est
 * enregistré normalement et une fiche « en attente de répartition » est écrite dans la même opération.
 * Elle est reprise plus tard (`retryPendingFeeAllocations`). La préparation ne fait que des lectures :
 * l'interrompre ne laisse aucune écriture partielle. */
export const pendingAllocationId = (schoolId, paymentId) => `payment_${createHash("sha256").update(JSON.stringify([schoolId, paymentId])).digest("hex").slice(0, 40)}`;

export async function prepareFeeAllocationReceiptNeverBlocking(input) {
  try {
    return await prepareFeeAllocationReceipt(input);
  } catch (error) {
    const source = input.payment ?? input.previous;
    if (!source?.id || !source?.schoolId) return () => {};
    const kind = input.previous ? (input.payment ? "correction" : "deletion") : "creation";
    const reason = String(error?.message ?? "Répartition indisponible.").slice(0, 300);
    console.warn("[Acadéa répartition] Paiement enregistré, répartition en attente.", { kind, code: error?.code ?? null });
    return () => input.transaction.set(input.db.doc(`feeAllocationPending/${pendingAllocationId(source.schoolId, source.id)}`), {
      schoolId: source.schoolId, paymentId: source.id, kind, reason, status: "pending", createdAt: input.now, updatedAt: input.now,
    }, { merge: true });
  }
}

/** Reprise des créations en attente, dans l'ordre des encaissements, chacune dans sa propre opération.
 * Une correction ou suppression en attente reste signalée « à rapprocher » (jamais devinée). */
export async function retryPendingFeeAllocations({ db, caller, schoolId, now = new Date().toISOString(), max = 25 }) {
  const snapshot = await db.collection("feeAllocationPending").where("schoolId", "==", schoolId).where("status", "==", "pending").get();
  const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, max);
  let processed = 0, remaining = 0;
  for (const item of items) {
    if (item.kind !== "creation") { remaining += 1; continue; }
    try {
      await db.runTransaction(async (transaction) => {
        const ref = db.doc(`feeAllocationPending/${item.id}`);
        const [pending, paymentSnap] = await Promise.all([transaction.get(ref), transaction.get(db.doc(`payments/${item.paymentId}`))]);
        if (!pending.exists || pending.data()?.status !== "pending") return;
        if (!paymentSnap.exists) { transaction.set(ref, { status: "closed", closedReason: "Paiement supprimé avant répartition.", updatedAt: now }, { merge: true }); return; }
        const payment = { id: paymentSnap.id, ...paymentSnap.data() };
        // Même contrôle qu'à l'encaissement : on reprend le compte qui a encaissé (Caissier ou Administrateur).
        const creatorId = payment.createdBy ?? caller.uid;
        const creator = (await transaction.get(db.doc(`users/${creatorId}`))).data() ?? {};
        const role = creator.role === "admin" ? "school_admin" : creator.role;
        const write = await prepareFeeAllocationReceipt({ db, transaction, caller: { uid: creatorId, role, schoolId }, payment, requestId: `retry_${item.id}`, now });
        write();
        transaction.set(ref, { status: "done", updatedAt: now }, { merge: true });
      });
      processed += 1;
    } catch { remaining += 1; }
  }
  return { processed, remaining: remaining + Math.max(0, snapshot.docs.length - items.length) };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lot 27a : reprise automatique par le serveur, sans dépendre d'aucun écran.
 * - juste après chaque paiement (avec nouvelles tentatives rapprochées) ;
 * - juste avant chaque dépense et chaque paiement du personnel, pour que le disponible soit juste.
 * Ne lève jamais d'erreur : elle ne doit bloquer ni un paiement ni une dépense. */
export async function settlePendingFeeAllocations({ db, caller, schoolId, now = new Date().toISOString(), attempts = 3, delayMs = 250 }) {
  if (!schoolId || typeof db?.collection !== "function") return { processed: 0, remaining: 0 };
  let total = 0, last = { processed: 0, remaining: 0 };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { last = await retryPendingFeeAllocations({ db, caller, schoolId, now }); } catch { last = { processed: 0, remaining: -1 }; }
    total += last.processed;
    if (last.remaining === 0) break;
    if (attempt + 1 < attempts) await pause(delayMs * (attempt + 1));
  }
  return { processed: total, remaining: last.remaining };
}
