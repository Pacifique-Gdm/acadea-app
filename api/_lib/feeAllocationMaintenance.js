import { createHash } from "node:crypto";
import { AggregateField } from "firebase-admin/firestore";
import { feeAllocationPaymentRequestId } from "./feeAllocationReceipts.js";
import { retryPendingFeeAllocations } from "./feeAllocationPending.js";
import { toMoneyMinor } from "./money.js";

/** Lot 27a-bis — protections de la répartition des frais (décision du propriétaire, 17/11/2026).
 * Appelé par une tâche programmée Firebase (toutes les 10 minutes, et chaque nuit), jamais par un écran.
 * Économe : une seule lecture quand rien n'est en attente ; le contrôle de nuit utilise les soldes
 * déjà calculés et des sommes faites par Firestore (aucune relecture des paiements un par un). */
const HOUR_MS = 60 * 60 * 1000;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const money = (minor, currency) => `${(minor / 100).toFixed(2)} ${currency}`;

async function recipients(db, schoolId) {
  const [admins, superAdmins] = await Promise.all([
    db.collection("users").where("schoolId", "==", schoolId).where("role", "in", ["school_admin", "admin"]).get(),
    db.collection("users").where("role", "==", "super_admin").get(),
  ]);
  const active = (doc) => doc.data().status !== "inactive" && doc.data().active !== false;
  return { admins: admins.docs.filter(active).map((doc) => doc.id), superAdmins: superAdmins.docs.filter(active).map((doc) => doc.id) };
}

function notification({ id, userId, school, schoolYearId, title, body, platform, now }) {
  return { id, recipientUserId: userId, type: "allocation_alert", module: "allocation", event: "allocation_alert", destination: "/dashboard",
    title, body, createdAt: now, read: false,
    ...(platform ? { platformMessage: true, schoolId: school.id } : { schoolId: school.id, schoolYearId, recipientRole: "school" }) };
}

/** Toutes les 10 minutes : reprend les paiements en attente de toutes les écoles, puis alerte après une heure. */
export async function runAllocationMaintenance({ db, now = new Date().toISOString() }) {
  const pending = await db.collection("feeAllocationPending").where("status", "==", "pending").limit(200).get();
  if (pending.empty) return { pending: 0, processed: 0, alerts: 0 };
  const schools = [...new Set(pending.docs.map((doc) => doc.data().schoolId).filter(Boolean))];
  let processed = 0;
  for (const schoolId of schools) processed += (await retryPendingFeeAllocations({ db, caller: null, schoolId, now })).processed;
  // Alerte : encore en attente après une heure, une seule fois par paiement.
  const still = await db.collection("feeAllocationPending").where("status", "==", "pending").limit(200).get();
  const late = still.docs.filter((doc) => !doc.data().alertedAt && Date.parse(now) - Date.parse(doc.data().createdAt) >= HOUR_MS);
  let alerts = 0;
  for (const schoolId of [...new Set(late.map((doc) => doc.data().schoolId))]) {
    const items = late.filter((doc) => doc.data().schoolId === schoolId);
    const school = { id: schoolId, ...(await db.doc(`schools/${schoolId}`).get()).data() };
    const people = await recipients(db, schoolId);
    const title = "Répartition des frais : paiement(s) en attente";
    const body = `${items.length} paiement(s) de ${school.name ?? "l'école"} sont encaissés mais pas encore répartis depuis plus d'une heure. Ouvrez « Répartition des frais » pour le détail.`;
    const batch = db.batch();
    for (const userId of people.admins) batch.set(db.doc(`notifications/allocation_alert_${hash([schoolId, userId, items.map((d) => d.id)])}`),
      notification({ id: `allocation_alert_${hash([schoolId, userId, items.map((d) => d.id)])}`, userId, school, schoolYearId: school.activeSchoolYearId ?? null, title, body, platform: false, now }));
    for (const userId of people.superAdmins) batch.set(db.doc(`notifications/allocation_alert_${hash([schoolId, userId, items.map((d) => d.id), "platform"])}`),
      notification({ id: `allocation_alert_${hash([schoolId, userId, items.map((d) => d.id), "platform"])}`, userId, school, title, body, platform: true, now }));
    for (const doc of items) batch.set(doc.ref, { alertedAt: now }, { merge: true });
    await batch.commit();
    alerts += people.admins.length + people.superAdmins.length;
  }
  return { pending: pending.size ?? pending.docs.length, processed, alerts };
}

async function sumAmounts(query) {
  if (typeof query.aggregate === "function") {
    const snapshot = await query.aggregate({ total: AggregateField.sum("amount") }).get();
    return Math.round(Number(snapshot.data().total ?? 0) * 100);
  }
  const snapshot = await query.get(); // base en mémoire des tests
  return snapshot.docs.reduce((sum, doc) => sum + toMoneyMinor(Number(doc.data().amount)), 0);
}

/** Chaque nuit : tout l'encaissé depuis l'activation doit être réparti, au centime près, par école, année et devise. */
export async function runAllocationNightlyCheck({ db, now = new Date().toISOString() }) {
  const states = await db.collection("feeAllocationStates").where("status", "in", ["ACTIVE", "PAUSED"]).get();
  const reports = [];
  for (const stateDoc of states.docs) {
    const { schoolId, schoolYearId, currency, cutoffAt } = stateDoc.data();
    const payments = db.collection("payments").where("schoolId", "==", schoolId).where("currency", "==", currency);
    // Encaissements de l'année (A) + arriérés et anciens élèves encaissés cette année (B), sans compter deux fois (C).
    const [a, b, c] = await Promise.all([
      sumAmounts(payments.where("schoolYearId", "==", schoolYearId).where("createdAt", ">=", cutoffAt)),
      sumAmounts(payments.where("collectionSchoolYearId", "==", schoolYearId).where("createdAt", ">=", cutoffAt)),
      sumAmounts(payments.where("collectionSchoolYearId", "==", schoolYearId).where("schoolYearId", "==", schoolYearId).where("createdAt", ">=", cutoffAt)),
    ]);
    const collected = a + b - c;
    const [balances, pending] = await Promise.all([
      db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId).where("currency", "==", currency).get(),
      db.collection("feeAllocationPending").where("schoolId", "==", schoolId).where("status", "==", "pending").get(),
    ]);
    const allocated = balances.docs.reduce((sum, doc) => sum + (doc.data().receivedMinor ?? 0), 0);
    // Les paiements encore en attente sont connus : on retire leur part non encore répartie.
    let waiting = 0;
    for (const doc of pending.docs) {
      const [payment, prior] = await Promise.all([db.doc(`payments/${doc.data().paymentId}`).get(), db.doc(`feeAllocationRequests/${feeAllocationPaymentRequestId(schoolId, doc.data().paymentId)}`).get()]);
      const current = payment.exists && payment.data().currency === currency && String(payment.data().createdAt) >= cutoffAt ? toMoneyMinor(Number(payment.data().amount)) : 0;
      waiting += current - (prior.exists && !prior.data().deleted ? prior.data().amountMinor ?? 0 : 0);
    }
    const gap = collected - waiting - allocated;
    const report = { schoolId, schoolYearId, currency, collectedMinor: collected, allocatedMinor: allocated, waitingMinor: waiting, gapMinor: gap, pendingCount: pending.docs.length, checkedAt: now };
    reports.push(report);
    await db.doc(`feeAllocationChecks/${hash([schoolId, schoolYearId, currency, now.slice(0, 10)])}`).set(report);
    if (gap !== 0) {
      const school = { id: schoolId, ...(await db.doc(`schools/${schoolId}`).get()).data() };
      const { superAdmins } = await recipients(db, schoolId);
      const batch = db.batch();
      for (const userId of superAdmins) {
        const id = `allocation_check_${hash([schoolId, schoolYearId, currency, now.slice(0, 10), userId])}`;
        batch.set(db.doc(`notifications/${id}`), notification({ id, userId, school, title: "Répartition des frais : écart au contrôle de nuit",
          body: `${school.name ?? schoolId} (${currency}) : encaissé ${money(collected, currency)}, réparti ${money(allocated, currency)}, en attente ${money(waiting, currency)} (${pending.docs.length} paiement(s)), écart ${money(gap, currency)}.`,
          platform: true, now }));
      }
      await batch.commit();
    }
  }
  return { checked: reports.length, gaps: reports.filter((report) => report.gapMinor !== 0) };
}
