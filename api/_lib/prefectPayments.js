import { GradingApiError } from "./teacherGrading.js";
import { requirePrefect } from "./prefectDashboard.js";
import { listScopedStudentArrearsBatch } from "./financialTransactions.js";

// Lot P4 (Préfet d'études) : situation des paiements de SES sections, SANS AUCUN MONTANT.
// Le serveur réutilise le calcul des arriérés de la caisse (prises en charge déduites, années passées comprises) :
//  - « en ordre » = aucun reste à payer ; « en retard » = un reste à payer ;
//  - « non calculé » = le calcul a échoué pour ce paquet d'élèves (jamais compté comme en ordre).
// Il ne renvoie que des nombres et des pourcentages par classe : ni montant, ni nom d'élève.
// Aucune règle de sécurité ne change : le Préfet ne lit toujours pas les paiements lui-même.
const BATCH = 50;
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new GradingApiError(400, "invalid-argument", `${label} invalide.`);
  return value.trim();
};
const serialize = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));
const percent = (part, total) => total ? Math.round(part / total * 100) : null;

/** Calcul pur. `totals` : identifiant d'élève → { USD, CDF } (reste à payer), absent = non calculé. */
export function computePrefectPayments({ sections, students, totals }) {
  const allowed = new Set(sections);
  const byClass = new Map();
  for (const student of students) {
    if (!allowed.has(student.section) || (student.status ?? "ACTIVE") !== "ACTIVE" || student.deletedAt) continue;
    const className = String(student.className ?? "").trim() || "Sans classe";
    const row = byClass.get(className) ?? { className, students: 0, upToDate: 0, late: 0, unknown: 0 };
    row.students += 1;
    const total = totals[student.id];
    if (!total || ![total.USD, total.CDF].every((value) => Number.isFinite(value) && value >= 0)) row.unknown += 1;
    else if (total.USD > 0 || total.CDF > 0) row.late += 1;
    else row.upToDate += 1;
    byClass.set(className, row);
  }
  const classes = [...byClass.values()].map((row) => {
    const known = row.upToDate + row.late;
    return { ...row, upToDateRate: percent(row.upToDate, known), lateRate: percent(row.late, known) };
  }).sort((a, b) => a.className.localeCompare(b.className, "fr", { numeric: true }));
  const upToDate = classes.reduce((sum, row) => sum + row.upToDate, 0), late = classes.reduce((sum, row) => sum + row.late, 0);
  return { sections: [...allowed], classes, overall: { students: classes.reduce((sum, row) => sum + row.students, 0), upToDate, late,
    unknown: classes.reduce((sum, row) => sum + row.unknown, 0), upToDateRate: percent(upToDate, upToDate + late) } };
}

export async function loadPrefectPayments({ db, caller, body, arrearsLoader = listScopedStudentArrearsBatch }) {
  const schoolId = text(body.schoolId, "École"), schoolYearId = text(body.schoolYearId, "Année scolaire");
  const { sections } = await requirePrefect(db, caller, schoolId, schoolYearId);
  if (!sections.length) return computePrefectPayments({ sections, students: [], totals: {} });
  const scoped = (name) => db.collection(name).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const students = (await Promise.all(chunks(sections, 30).map((part) => scoped("students").where("section", "in", part).get()))).flatMap(serialize)
    .filter((student) => (student.status ?? "ACTIVE") === "ACTIVE" && !student.deletedAt);
  const totals = {};
  // Un paquet à la fois : même calcul que la caisse, en lecture seule.
  for (const part of chunks(students.map((student) => student.id), BATCH)) {
    try {
      Object.assign(totals, (await arrearsLoader({ db, studentIds: part, schoolIds: [schoolId] })).totals ?? {});
    } catch {
      // Paquet non calculé : ses élèves restent « non calculés », jamais « en ordre ».
    }
  }
  return computePrefectPayments({ sections, students, totals });
}
