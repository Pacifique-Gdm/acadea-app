import { createHash } from "node:crypto";
import { FeeAllocationError, validateFeeAllocationOpeningProposal } from "./feeAllocationMath.js";
import { toMoneyMinor } from "./money.js";

/** Read-only preparatory check. Never an approval or an authoritative cash reconciliation.
 * The caller must have authorized the scope before invoking this server-only helper.
 * Future activation still requires an exhaustive cash ledger reconciliation, including
 * payroll, other inflows, reversals and already allocated sources (phases 3–5).
 */
export async function inspectFeeAllocationOpeningEvidence({ db, proposal }) {
  const checked = validateFeeAllocationOpeningProposal(proposal);
  const reject = (message) => { throw new FeeAllocationError(409, "evidence-unverified", message); };
  const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
  if (!validId(proposal.schoolId) || !validId(proposal.collectionSchoolYearId) || !["USD", "CDF"].includes(proposal.currency)
    || !validId(proposal.reconciledBy)) reject("Périmètre ou auteur du rapprochement invalide.");
  const evidence = [];
  // A read-only transaction provides a consistent snapshot; no writes, even on failure.
  await db.runTransaction(async (transaction) => {
    evidence.length = 0;
    const year = await transaction.get(db.doc(`schoolYears/${proposal.collectionSchoolYearId}`));
    if (!year.exists || year.data().schoolId !== proposal.schoolId) reject("Année de rapprochement hors périmètre.");
    for (const ref of proposal.evidence) {
      const snapshot = await transaction.get(db.doc(`${ref.collection}/${ref.id}`));
      if (!snapshot.exists) reject("Pièce justificative introuvable.");
      const record = snapshot.data();
      const yearId = ref.collection === "payments" ? record.collectionSchoolYearId ?? record.schoolYearId : record.schoolYearId;
      if (record.schoolId !== proposal.schoolId || yearId !== proposal.collectionSchoolYearId || record.currency !== proposal.currency) reject("Pièce justificative hors périmètre, année ou devise.");
      if (record.deletedAt || record.cancelledAt || record.reversedAt || record.provisional === true
        || ["cancelled", "canceled", "deleted", "void", "reversed", "pending", "provisional"].includes(record.status)) reject("Pièce non définitive ou annulée.");
      const at = ref.collection === "payments" ? record.paidAt : record.spentAt;
      if (typeof at !== "string" || Number.isNaN(Date.parse(at)) || at.slice(0, 10) > proposal.cutoffAt) reject("Date de pièce absente ou postérieure à la coupure.");
      let amountMinor;
      try { amountMinor = toMoneyMinor(record.amount); } catch { reject("Montant de pièce invalide."); }
      if (amountMinor <= 0) reject("Montant de pièce non positif.");
      if (ref.collection === "payments" && (!validId(record.studentId) || !validId(record.feeTypeId))) reject("Origine scolaire de la pièce non vérifiable.");
      if (ref.collection === "payments") {
        const [student, fee] = await Promise.all([transaction.get(db.doc(`students/${record.studentId}`)), transaction.get(db.doc(`feeTypes/${record.feeTypeId}`))]);
        if (!student.exists || !fee.exists || student.data().schoolId !== proposal.schoolId || fee.data().schoolId !== proposal.schoolId
          || fee.data().schoolYearId !== record.schoolYearId) reject("Références scolaires de la pièce incohérentes.");
      }
      evidence.push({ collection: ref.collection, id: ref.id, amountMinor, at, revision: record.updatedAt ?? record.createdAt ?? at });
    }
  });
  const credits = evidence.filter((row) => row.collection === "payments").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
  const debits = evidence.filter((row) => row.collection === "expenses").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
  if (credits - debits < BigInt(proposal.proposedOpeningMinor) || credits < BigInt(proposal.justifiedSchoolFeeMinor)) reject("Les pièces ne justifient pas les montants déclarés.");
  evidence.sort((a, b) => `${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`));
  return { ...checked, approved: false, eligibleForReview: false, evidenceVerified: true,
    activationBlocked: true, remainingRequirement: "exhaustive-cash-reconciliation",
    inspectedAt: new Date().toISOString(), inspectedBy: proposal.reconciledBy, evidence,
    digest: createHash("sha256").update(JSON.stringify([proposal.schoolId, proposal.collectionSchoolYearId, proposal.currency, proposal.cutoffAt, evidence])).digest("hex") };
}
