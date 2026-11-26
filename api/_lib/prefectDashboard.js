import { GradingApiError, studentMatchesAssignment } from "./teacherGrading.js";
import { calculateConsolidatedReport, GRADE_SLOTS } from "./consolidatedGrading.js";
import { operationalBaseClassId } from "../../src/utils/studentYearTransition.js";
import { teacherSections } from "./studySectionScope.js";

// Lot P1 (Préfet d'études) : tableau de pilotage de SES sections.
// Le serveur lit les présences, les cotes et les indisponibilités, puis renvoie SEULEMENT des nombres
// et des pourcentages (aucun nom d'élève, aucun montant). Aucune règle de sécurité ne change.
export const PREFECT_FUNCTION = "prefect_of_studies";
export const DIFFICULTY_THRESHOLD = 50;
const SLOT_LABELS = {
  period_1: "1ère Période", period_2: "2ème Période", semester_1_exam: "Examen 1er Semestre",
  period_3: "3ème Période", period_4: "4ème Période", semester_2_exam: "Examen 2ème Semestre",
};
const fail = (status, message) => { throw new GradingApiError(status, status === 403 ? "permission-denied" : "invalid-argument", message); };
const serialize = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(400, `${label} invalide.`);
  return value.trim();
};
const chunks = (values) => Array.from({ length: Math.ceil(values.length / 30) }, (_, index) => values.slice(index * 30, index * 30 + 30));

export function prefectSections(user) {
  const values = Array.isArray(user?.sectionIds) && user.sectionIds.length ? user.sectionIds : user?.section ? [user.section] : [];
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

/** Compte autorisé : Direction des études, fonction « Préfet d'études », actif, de cette école. */
export async function requirePrefect(db, caller, schoolId, schoolYearId) {
  if (caller?.role !== "study_director" || caller.schoolId !== schoolId) fail(403, "Réservé au Préfet d'études.");
  const [user, school, year] = await Promise.all([
    db.doc(`users/${caller.uid}`).get(), db.doc(`schools/${schoolId}`).get(), db.doc(`schoolYears/${schoolYearId}`).get(),
  ]);
  const profile = user.data();
  if (!user.exists || profile?.role !== "study_director" || profile?.schoolId !== schoolId || profile?.active === false || profile?.status === "inactive"
    || profile?.studyFunction !== PREFECT_FUNCTION) fail(403, "Réservé au Préfet d'études.");
  if (!school.exists || ["suspended", "inactive", "deleting"].includes(school.data()?.status) || !year.exists || year.data()?.schoolId !== schoolId) {
    fail(403, "École ou année scolaire invalide.");
  }
  return { profile, sections: prefectSections(profile) };
}

/** Calcul pur (testable) : effectifs, présence du jour, élèves en difficulté, absences approuvées. */
export function computePrefectDashboard({ sections, today, students, attendance, classes, subjects, assignments, configs, entries, teachers, requests, teacherUsers = [] }) {
  const allowed = new Set(sections);
  const scopedStudents = students.filter((student) => allowed.has(student.section) && (student.status ?? "ACTIVE") === "ACTIVE" && !student.deletedAt);
  const studentIds = new Set(scopedStudents.map((student) => student.id));
  const classNames = new Set(scopedStudents.map((student) => String(student.className ?? "").trim()).filter(Boolean));

  const todayRecords = new Map();
  for (const record of attendance) if (record.attendanceDate === today && studentIds.has(record.studentId)) todayRecords.set(record.studentId, record.status);
  const recorded = todayRecords.size;
  const present = [...todayRecords.values()].filter((status) => status === "present" || status === "late").length;
  const presence = { recorded, present, absent: recorded - present, rate: recorded ? Math.round(present / recorded * 100) : null };

  const scopedClasses = classes.filter((item) => allowed.has(item.section));
  const reports = [];
  for (const schoolClass of scopedClasses) {
    if (!students.some((student) => studentIds.has(student.id) && studentMatchesAssignment(student, { classId: schoolClass.id, schoolId: schoolClass.schoolId, schoolYearId: schoolClass.schoolYearId }, schoolClass, classes.find((item) => item.id === operationalBaseClassId(schoolClass))))) continue;
    try {
      reports.push(calculateConsolidatedReport({ classId: schoolClass.id, students: scopedStudents, classes, subjects, assignments, configs, entries }));
    } catch {
      // Une classe incomplète ne bloque pas le tableau.
    }
  }
  let slot = null;
  for (const candidate of [...GRADE_SLOTS].reverse()) {
    if (reports.some((report) => report.students.some((row) => row.evaluations[candidate]?.complete))) { slot = candidate; break; }
  }
  const evaluated = new Set(), struggling = new Set();
  if (slot) for (const report of reports) for (const row of report.students) {
    const evaluation = row.evaluations[slot];
    if (!evaluation?.complete) continue;
    evaluated.add(row.student.id);
    if (evaluation.percentage < DIFFICULTY_THRESHOLD) struggling.add(row.student.id);
  }

  // Section d'un enseignant : celle de son COMPTE `users` (là où l'application l'enregistre), sinon sa fiche.
  const userById = new Map(teacherUsers.map((item) => [item.id, item]));
  const sectionTeacherIds = new Set(teachers.filter((teacher) => {
    if (teacherSections(teacher, userById.get(teacher.userId)).some((section) => allowed.has(section))) return true;
    return assignments.some((assignment) => assignment.teacherId === teacher.id && scopedClasses.some((item) => item.id === assignment.classId));
  }).map((teacher) => teacher.id));
  const teacherName = new Map(teachers.map((teacher) => [teacher.id, String(teacher.fullName ?? `${teacher.lastName ?? ""} ${teacher.firstName ?? ""}`).trim()]));
  const absences = requests.filter((request) => request.status === "APPROVED" && request.requestedDate === today && sectionTeacherIds.has(request.teacherId))
    .map((request) => ({ teacherName: teacherName.get(request.teacherId) || "Enseignant", requestType: request.requestType === "TIME_RANGE" ? "TIME_RANGE" : "FULL_DAY",
      ...(request.requestType === "TIME_RANGE" ? { startTime: request.startTime ?? "", endTime: request.endTime ?? "" } : {}) }))
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName, "fr"));

  return {
    sections: [...allowed], today,
    enrollment: { students: scopedStudents.length, classes: classNames.size },
    presence,
    difficulty: { slot, slotLabel: slot ? SLOT_LABELS[slot] : null, threshold: DIFFICULTY_THRESHOLD, evaluated: evaluated.size, count: struggling.size },
    approvedAbsences: { count: absences.length, items: absences },
  };
}

export async function loadPrefectDashboard({ db, caller, body }) {
  const schoolId = text(body.schoolId, "École"), schoolYearId = text(body.schoolYearId, "Année scolaire");
  const today = text(body.today, "Date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(400, "Date invalide.");
  const { sections } = await requirePrefect(db, caller, schoolId, schoolYearId);
  if (!sections.length) return computePrefectDashboard({ sections, today, students: [], attendance: [], classes: [], subjects: [], assignments: [], configs: [], entries: [], teachers: [], requests: [] });
  const scoped = (name) => db.collection(name).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const [students, attendance, classes, subjects, assignments, teachers, requests, teacherUsers] = await Promise.all([
    Promise.all(chunks(sections).map((part) => scoped("students").where("section", "in", part).get())).then((list) => list.flatMap(serialize)),
    scoped("attendance").where("attendanceDate", "==", today).get().then(serialize),
    scoped("classes").get().then(serialize),
    scoped("subjects").get().then(serialize),
    scoped("pedagogicalAssignments").where("active", "==", true).get().then(serialize),
    scoped("teachers").get().then(serialize),
    scoped("teacherAvailabilityRequests").where("requestedDate", "==", today).get().then(serialize),
    db.collection("users").where("schoolId", "==", schoolId).where("role", "==", "teacher").get().then(serialize),
  ]);
  const classIds = [...new Set(classes.filter((item) => sections.includes(item.section)).map((item) => item.id)
    .concat(assignments.filter((item) => classes.some((schoolClass) => schoolClass.id === item.classId && sections.includes(schoolClass.section))).map((item) => item.classId)))];
  const byClass = async (name) => (await Promise.all(chunks(classIds).map((part) => scoped(name).where("classId", "in", part).get()))).flatMap(serialize);
  const [configs, entries] = classIds.length ? await Promise.all([byClass("courseGradingConfigs"), byClass("gradeEntries")]) : [[], []];
  return computePrefectDashboard({ sections, today, students, attendance, classes, subjects, assignments, configs, entries, teachers, requests, teacherUsers });
}
