import type { Payment, Student } from "../types";
import { loadStudentArrearsBatch } from "./financialTransactions";
import { loadCoordinationStudentArrearsBatch } from "./coordinationService";
import { sumMoney } from "../utils/money";

/** Arriérés du tableau de bord gardés par élève, en mémoire de l'onglet
 * navigateur. Un résultat n'est réutilisé que si l'empreinte de l'élève
 * (fiche financière et paiements connus) est identique : un paiement d'un
 * autre utilisateur, reçu en temps réel, invalide l'élève concerné. Les
 * paiements qu'on ne peut rattacher à aucun élève affiché invalident tout,
 * par prudence. Aucun stockage persistant : rien ne survit à un rechargement. */
export type ArrearsTotals = { USD: number; CDF: number };
export type ArrearsStudent = Pick<Student, "id" | "schoolId" | "schoolYearId" | "financialSupport">;
export type ArrearsPayment = Pick<Payment, "id" | "amount" | "studentId" | "currentStudentId" | "schoolYearId">;
export type ArrearsLoader = (schoolYearId: string, studentIds: string[]) => Promise<Record<string, ArrearsTotals>>;

const BATCH_SIZE = 50;
const cache = new Map<string, { fingerprint: string; totals: ArrearsTotals }>();

const cacheKey = (scope: string, coordination: boolean, studentId: string) => `${scope}\u001f${coordination ? "c" : "s"}\u001f${studentId}`;
const paymentRow = ({ id, amount, studentId, currentStudentId, schoolYearId }: ArrearsPayment) => [id, amount, studentId ?? "", currentStudentId ?? "", schoolYearId ?? ""];
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

export function arrearsFingerprints(students: readonly ArrearsStudent[], payments: readonly ArrearsPayment[]) {
  const ids = new Set(students.map((student) => student.id));
  const owned = new Map<string, ArrearsPayment[]>();
  const unmatched: ArrearsPayment[] = [];
  for (const payment of payments) {
    const owners = [payment.currentStudentId, payment.studentId].filter((id, index, all): id is string => Boolean(id) && ids.has(id as string) && all.indexOf(id) === index);
    if (!owners.length) unmatched.push(payment);
    for (const owner of owners) owned.set(owner, [...(owned.get(owner) ?? []), payment]);
  }
  const unmatchedPrint = JSON.stringify([...unmatched].sort(byId).map(paymentRow));
  return new Map(students.map((student) => [student.id, JSON.stringify([
    student.id, student.schoolId, student.schoolYearId, student.financialSupport ?? null,
    [...(owned.get(student.id) ?? [])].sort(byId).map(paymentRow), unmatchedPrint,
  ])]));
}

/** Totaux immédiatement disponibles, ou la liste des élèves à recalculer. */
export function readCachedArrears(students: readonly ArrearsStudent[], payments: readonly ArrearsPayment[], scope: string, coordination: boolean) {
  const prints = arrearsFingerprints(students, payments);
  const unique = [...new Map(students.map((student) => [student.id, student])).values()];
  const stale = unique.filter((student) => cache.get(cacheKey(scope, coordination, student.id))?.fingerprint !== prints.get(student.id));
  if (stale.length) return { stale, prints, totals: undefined };
  let totals: ArrearsTotals = { USD: 0, CDF: 0 };
  for (const student of unique) {
    const value = cache.get(cacheKey(scope, coordination, student.id))!.totals;
    totals = { USD: sumMoney([totals.USD, value.USD]), CDF: sumMoney([totals.CDF, value.CDF]) };
  }
  return { stale, prints, totals };
}

/** Recalcule seulement les élèves périmés, par paquets de 50 et par année ;
 * chaque paquet réussi est gardé même si un paquet suivant échoue. */
export async function refreshStaleArrears(stale: readonly ArrearsStudent[], prints: ReadonlyMap<string, string>, scope: string, coordination: boolean,
  options: { isCancelled?: () => boolean; loader?: ArrearsLoader } = {}) {
  const loader: ArrearsLoader = options.loader ?? (coordination ? (_year, ids) => loadCoordinationStudentArrearsBatch(ids) : loadStudentArrearsBatch);
  const groups = new Map<string, string[]>();
  for (const student of stale) groups.set(student.schoolYearId, [...(groups.get(student.schoolYearId) ?? []), student.id]);
  for (const [yearId, ids] of groups) {
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      if (options.isCancelled?.()) return;
      const batch = ids.slice(offset, offset + BATCH_SIZE);
      const values = await loader(yearId, batch);
      for (const id of batch) {
        const print = prints.get(id);
        if (print !== undefined && values[id]) cache.set(cacheKey(scope, coordination, id), { fingerprint: print, totals: { USD: values[id].USD, CDF: values[id].CDF } });
      }
    }
  }
}

export function clearDashboardArrearsCache() {
  cache.clear();
}
