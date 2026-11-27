import { GradingApiError } from "./teacherGrading.js";
import { requirePrefect } from "./prefectDashboard.js";
import { teacherSections } from "./studySectionScope.js";

// Lot P3 (Préfet d'études) : enseignants de SES sections, avec leurs cours, leur charge
// (périodes par semaine) et leurs absences approuvées (indisponibilités ; il n'existe pas de pointage).
// Lu par le serveur et filtré sur ses sections. Ni motif d'absence, ni téléphone, ni adresse.
// Aucune règle de sécurité ne change.
const MAX_ABSENCES = 5;
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new GradingApiError(400, "invalid-argument", `${label} invalide.`);
  return value.trim();
};
const serialize = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const textField = (value) => typeof value === "string" ? value.trim() : "";
const teacherLabel = (teacher) => textField(teacher.fullName) || `${textField(teacher.lastName)} ${textField(teacher.firstName)}`.trim() || "Enseignant";

/**
 * Calcul pur (testable). Un enseignant est retenu si l'une de ses sections (compte `users`, sinon fiche)
 * est une section du Préfet, ou s'il a une affectation active dans une classe de ses sections.
 * Seuls les cours des classes de ses sections sont comptés.
 */
export function computePrefectStaff({ sections, today, teachers, teacherUsers = [], classes, subjects, assignments, requests }) {
  const allowed = new Set(sections);
  const scopedClasses = new Map(classes.filter((item) => allowed.has(item.section) && item.active !== false).map((item) => [item.id, item]));
  const subjectName = new Map(subjects.map((item) => [item.id, textField(item.name)]));
  const userById = new Map(teacherUsers.map((item) => [item.id, item]));
  const activeAssignments = assignments.filter((item) => item.active !== false && scopedClasses.has(item.classId));

  const rows = teachers.filter((teacher) => teacher.status !== "inactive" && !teacher.deletedAt).map((teacher) => {
    const own = activeAssignments.filter((item) => item.teacherId === teacher.id);
    const inSections = teacherSections(teacher, userById.get(teacher.userId)).some((section) => allowed.has(section));
    if (!inSections && !own.length) return null;
    const courses = own.map((item) => ({
      subjectName: subjectName.get(item.subjectId) || "Cours",
      className: textField(scopedClasses.get(item.classId)?.name) || "Classe",
      weeklyPeriods: Number.isFinite(item.weeklyPeriods) && item.weeklyPeriods > 0 ? item.weeklyPeriods : 0,
    })).sort((a, b) => a.className.localeCompare(b.className, "fr") || a.subjectName.localeCompare(b.subjectName, "fr"));
    const absences = requests.filter((request) => request.teacherId === teacher.id && request.status === "APPROVED"
      && typeof request.requestedDate === "string" && request.requestedDate >= today)
      .sort((a, b) => a.requestedDate.localeCompare(b.requestedDate) || textField(a.startTime).localeCompare(textField(b.startTime)))
      .map((request) => ({ date: request.requestedDate, requestType: request.requestType === "TIME_RANGE" ? "TIME_RANGE" : "FULL_DAY",
        ...(request.requestType === "TIME_RANGE" ? { startTime: textField(request.startTime), endTime: textField(request.endTime) } : {}) }));
    return {
      id: teacher.id, teacherName: teacherLabel(teacher), courses,
      weeklyPeriods: courses.reduce((sum, course) => sum + course.weeklyPeriods, 0),
      absentToday: absences.some((absence) => absence.date === today),
      upcomingAbsences: absences.slice(0, MAX_ABSENCES), upcomingAbsenceCount: absences.length,
    };
  }).filter(Boolean).sort((a, b) => a.teacherName.localeCompare(b.teacherName, "fr"));
  return { sections: [...allowed], today, teachers: rows };
}

export async function listPrefectStaff({ db, caller, body }) {
  const schoolId = text(body.schoolId, "École"), schoolYearId = text(body.schoolYearId, "Année scolaire");
  const today = text(body.today, "Date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new GradingApiError(400, "invalid-argument", "Date invalide.");
  const { sections } = await requirePrefect(db, caller, schoolId, schoolYearId);
  if (!sections.length) return { sections: [], today, teachers: [] };
  const scoped = (name) => db.collection(name).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const [teachers, teacherUsers, classes, subjects, assignments, requests] = await Promise.all([
    scoped("teachers").get().then(serialize),
    db.collection("users").where("schoolId", "==", schoolId).where("role", "==", "teacher").get().then(serialize),
    scoped("classes").get().then(serialize),
    scoped("subjects").get().then(serialize),
    scoped("pedagogicalAssignments").where("active", "==", true).get().then(serialize),
    scoped("teacherAvailabilityRequests").where("status", "==", "APPROVED").get().then(serialize),
  ]);
  return computePrefectStaff({ sections, today, teachers, teacherUsers, classes, subjects, assignments, requests });
}
