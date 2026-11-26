import { GradingApiError } from "./teacherGrading.js";
import { requirePrefect } from "./prefectDashboard.js";

// Lot P2 (Préfet d'études) : discipline de SES sections, en lecture seule.
// Le serveur lit les sanctions saisies par le Directeur de discipline et ne renvoie que celles
// des élèves de ses sections, sans la description ni l'observation internes, ni l'auteur.
// Aucune règle de sécurité ne change : le Préfet ne lit toujours pas la collection lui-même.
const LIMIT = 300;
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new GradingApiError(400, "invalid-argument", `${label} invalide.`);
  return value.trim();
};
const serialize = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const chunks = (values) => Array.from({ length: Math.ceil(values.length / 30) }, (_, index) => values.slice(index * 30, index * 30 + 30));
const textField = (value) => typeof value === "string" ? value : "";

export function projectPrefectSanctions({ sections, students, sanctions }) {
  const allowed = new Set(sections);
  const scoped = new Map(students.filter((student) => allowed.has(student.section) && !student.deletedAt).map((student) => [student.id, student]));
  return sanctions.filter((sanction) => scoped.has(sanction.studentId))
    .map((sanction) => {
      const student = scoped.get(sanction.studentId);
      const name = textField(sanction.studentName) || [student.nom, student.postnom, student.prenom].filter(Boolean).join(" ");
      return {
        id: sanction.id, studentName: name, className: textField(sanction.className) || textField(student.className),
        reason: textField(sanction.reason), sanctionType: textField(sanction.sanctionType),
        duration: Number.isFinite(sanction.duration) ? sanction.duration : null,
        startDate: textField(sanction.startDate), expectedEndDate: textField(sanction.expectedEndDate),
        ...(sanction.actualEndDate ? { actualEndDate: textField(sanction.actualEndDate) } : {}),
        status: sanction.status === "completed" ? "completed" : "active",
        recurrenceNumber: Number.isFinite(sanction.recurrenceNumber) ? sanction.recurrenceNumber : 1,
      };
    })
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.studentName.localeCompare(b.studentName, "fr"))
    .slice(0, LIMIT);
}

export async function listPrefectDiscipline({ db, caller, body }) {
  const schoolId = text(body.schoolId, "École"), schoolYearId = text(body.schoolYearId, "Année scolaire");
  const { sections } = await requirePrefect(db, caller, schoolId, schoolYearId);
  if (!sections.length) return { sanctions: [] };
  const scoped = (name) => db.collection(name).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const [students, sanctions] = await Promise.all([
    Promise.all(chunks(sections).map((part) => scoped("students").where("section", "in", part).get())).then((list) => list.flatMap(serialize)),
    scoped("disciplineSanctions").get().then(serialize),
  ]);
  return { sanctions: projectPrefectSanctions({ sections, students, sanctions }) };
}
