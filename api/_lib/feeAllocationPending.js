import { createHash } from "node:crypto";
import { feeAllocationPaymentRequestId, prepareFeeAllocationReceipt, sourceDigest } from "./feeAllocationReceipts.js";

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
      schoolId: source.schoolId, paymentId: source.id, kind, reason, status: "pending", actorId: input.caller?.uid ?? null, createdAt: input.now, updatedAt: input.now,
    }, { merge: true });
  }
}

/** Reprise des paiements en attente (création, correction ou suppression), dans l'ordre, chacun dans sa
 * propre opération. Rien n'est deviné : l'état « déjà réparti » est la copie du paiement gardée dans son
 * dernier mouvement de répartition ; l'état « à répartir » est le paiement tel qu'il est enregistré
 * aujourd'hui (absent s'il a été supprimé). La répartition normale fait alors tous ses contrôles.
 * Deux reprises simultanées ne peuvent pas répartir deux fois : chaque opération relit la fiche en
 * attente et la fiche « déjà réparti » ; Firestore rejoue l'opération qui croise l'autre, qui voit alors
 * la fiche « done » et s'arrête. */
export async function retryPendingFeeAllocations({ db, caller, schoolId, now = new Date().toISOString(), max = 25 }) {
  const query = schoolId ? db.collection("feeAllocationPending").where("schoolId", "==", schoolId).where("status", "==", "pending")
    : db.collection("feeAllocationPending").where("status", "==", "pending");
  const snapshot = await query.get();
  const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, max);
  let processed = 0, remaining = 0;
  for (const item of items) {
    try {
      await db.runTransaction(async (transaction) => {
        const ref = db.doc(`feeAllocationPending/${item.id}`);
        const [pending, paymentSnap, priorSnap] = await Promise.all([transaction.get(ref), transaction.get(db.doc(`payments/${item.paymentId}`)),
          transaction.get(db.doc(`feeAllocationRequests/${feeAllocationPaymentRequestId(item.schoolId, item.paymentId)}`))]);
        if (!pending.exists || pending.data()?.status !== "pending") return;
        const payment = paymentSnap.exists ? { id: paymentSnap.id, ...paymentSnap.data() } : null;
        const prior = priorSnap.exists ? priorSnap.data() : null;
        let previous = null;
        if (prior && !prior.deleted) {
          const last = prior.lastMovementId ? (await transaction.get(db.doc(`feeAllocationMovements/${prior.lastMovementId}`))).data() : null;
          previous = last?.sourceSnapshot ?? null;
          if (!previous || sourceDigest(previous) !== prior.sourceDigest) throw new Error("Historique de répartition introuvable ou altéré : rapprochement nécessaire.");
        }
        if (!payment && !previous) { transaction.set(ref, { status: "closed", closedReason: "Paiement supprimé avant toute répartition.", updatedAt: now }, { merge: true }); return; }
        if (payment && previous && prior.sourceDigest === sourceDigest(payment)) { transaction.set(ref, { status: "done", updatedAt: now }, { merge: true }); return; }
        // Même contrôle qu'à l'encaissement : on reprend le compte qui a fait l'opération (Caissier ou Administrateur).
        const actorId = pending.data()?.actorId ?? payment?.updatedBy ?? payment?.createdBy ?? caller?.uid;
        const actor = actorId ? (await transaction.get(db.doc(`users/${actorId}`))).data() ?? {} : {};
        const role = actor.role === "admin" ? "school_admin" : actor.role;
        const write = await prepareFeeAllocationReceipt({ db, transaction, caller: { uid: actorId, role, schoolId: item.schoolId }, payment, previous: payment || previous ? previous : null,
          requestId: `retry_${item.id}_${prior?.lastMovementId ?? "first"}`, now });
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
