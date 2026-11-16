import type { FormerStudentDebts } from "../services/financialTransactions";
import type { Payment, Student } from "../types";

/** Élève archivé : statut autre qu'actif ou date d'archivage posée. */
export const isArchivedStudent = (student: Pick<Student, "status" | "deletedAt">) => (student.status ?? "ACTIVE") !== "ACTIVE" || Boolean(student.deletedAt);

/** Même recherche que « Enregistrer un paiement » : nom, postnom, prénom ou matricule, 8 résultats. */
export function searchFormerStudentsLocally(students: FormerStudentDebts[], query: string) {
  const search = query.trim().toLowerCase();
  return search ? students.filter((student) => `${student.name} ${student.matricule}`.toLowerCase().includes(search)).slice(0, 8) : [];
}

/** Liste visible : élèves archivés avec dette. Un élève de l'année réactivé
 * (écoute en temps réel) disparaît tout de suite, sans attendre le serveur. */
export function visibleFormerStudents(list: FormerStudentDebts[], yearStudents: Student[]) {
  const current = new Map(yearStudents.map((student) => [student.id, student]));
  return list.filter((item) => {
    const live = current.get(item.id);
    return item.debts.some((debt) => debt.remaining > 0) && !(live && !isArchivedStudent(live));
  });
}

/** Signature des changements qui demandent de relire la liste : élève de l'année
 * archivé ou réactivé, paiement enregistré pour un élève archivé. */
export function formerStudentsRefreshKey(yearStudents: Student[], payments: Payment[]) {
  const archivedIds = yearStudents.filter(isArchivedStudent).map((student) => student.id).sort();
  const archived = new Set(archivedIds);
  const paid = payments.filter((payment) => payment.formerStudent || archived.has(payment.studentId)).map((payment) => `${payment.id}:${payment.amount}`).sort();
  return JSON.stringify([archivedIds, paid]);
}
