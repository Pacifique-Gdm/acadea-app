import type { Payment, Student } from "../types";
import type { HistoricalDebt } from "./financialTransactions";

// « Dettes des années antérieures » : les années passées sont archivées (en lecture seule), leurs frais et leurs
// inscriptions ne changent plus. Ce qui peut encore changer une dette passée : un paiement d'arriéré (création,
// correction, annulation, encaissé dans l'année active) ou l'identité de la fiche (matricule, filiation, nom).
// Le résultat est donc gardé en mémoire, par utilisateur, par année et par élève, avec une « empreinte » de ces
// éléments : il n'est recalculé que si l'empreinte change. Rien n'est écrit sur l'appareil (mémoire de la page).
export type HistoricalArrears = { debts: HistoricalDebt[]; settled: HistoricalDebt[] };
type Entry = { fingerprint: string; at: number; promise: Promise<HistoricalArrears>; value?: HistoricalArrears };

const MAX_ENTRIES = 300;
const cache = new Map<string, Entry>();

export function historicalArrearsKey(userId: string, schoolYearId: string, studentId: string) {
  return `${userId}|${schoolYearId}|${studentId}`;
}

// Paiements qui touchent une dette passée : ceux d'une autre année que l'année active (arriérés, anciens élèves).
export function historicalArrearsFingerprint(
  student: Partial<Pick<Student, "id" | "matricule" | "importedFromStudentId" | "nom" | "postnom" | "prenom" | "birthDate" | "status">> | undefined,
  payments: readonly Payment[],
  activeSchoolYearId: string,
) {
  const id = student?.id ?? "";
  const debtPayments = payments
    .filter((payment) => (payment.currentStudentId === id || payment.studentId === id || payment.formerStudentId === id) && payment.schoolYearId !== activeSchoolYearId)
    .map((payment) => [payment.id, payment.amount, payment.schoolYearId, payment.feeTypeId, payment.updatedAt ?? "", (payment as { status?: string }).status ?? ""])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return JSON.stringify([id, student?.matricule ?? "", student?.importedFromStudentId ?? "", student?.nom ?? "", student?.postnom ?? "", student?.prenom ?? "", student?.birthDate ?? "", student?.status ?? "", debtPayments]);
}

/** Résultat déjà connu (affichage immédiat, sans indicateur de chargement), ou undefined. */
export function peekHistoricalArrears(key: string, fingerprint: string, maxAgeMs?: number, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry || entry.fingerprint !== fingerprint || (maxAgeMs !== undefined && now - entry.at > maxAgeMs)) return undefined;
  return entry.value;
}

/** Calcule une seule fois par empreinte ; deux ouvertures simultanées partagent le même calcul. */
export function cachedHistoricalArrears(key: string, fingerprint: string, load: () => Promise<HistoricalArrears>, { maxAgeMs, now = Date.now() }: { maxAgeMs?: number; now?: number } = {}) {
  const entry = cache.get(key);
  if (entry && entry.fingerprint === fingerprint && (maxAgeMs === undefined || now - entry.at <= maxAgeMs)) return entry.promise;
  const next: Entry = { fingerprint, at: now, promise: Promise.resolve() as unknown as Promise<HistoricalArrears> };
  next.promise = load().then((value) => { next.value = value; return value; });
  // Une erreur n'est jamais gardée : la prochaine ouverture réessaie.
  next.promise.catch(() => { if (cache.get(key) === next) cache.delete(key); });
  cache.delete(key);
  cache.set(key, next);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return next.promise;
}

export function clearHistoricalArrearsCache() {
  cache.clear();
}
