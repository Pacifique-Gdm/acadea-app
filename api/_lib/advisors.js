import { GradingApiError } from "./teacherGrading.js";
import { calculateConsolidatedReport, GRADE_SLOTS } from "./consolidatedGrading.js";
import { authoritySections, comparableSection, teacherInSections } from "./studySectionScope.js";
import { requireActiveSchoolYear } from "./schoolYear.js";

// Lots 10 et 11 : Conseiller pédagogique et Conseiller d'orientation.
// Tout est lu et écrit par le serveur : le navigateur n'a aucun accès direct aux élèves, aux cotes,
// aux fiches de visite ni aux notes de suivi. AUCUN accès à l'argent : aucune donnée de paiement n'est lue ici.
// Règle unique des sections : liste de sections vide = toute l'école (compte sans section, ou qui couvre
// toutes les sections de l'école) ; sinon seulement ses sections.
export const PEDAGOGICAL_ADVISOR = "pedagogical_advisor";
export const ADVISOR_ROLES = [PEDAGOGICAL_ADVISOR];
export const SLOT_LABELS = {
  period_1: "1ère Période", period_2: "2ème Période", semester_1_exam: "Examen 1er Semestre",
  period_3: "3ème Période", period_4: "4ème Période", semester_2_exam: "Examen 2ème Semestre",
};
const MAX_TEXT = 2000;
const fail = (status, message) => { throw new GradingApiError(status, status === 403 ? "permission-denied" : status === 404 ? "not-found" : status === 409 ? "failed-precondition" : "invalid-argument", message); };
const serialize = (snapshot) => (snapshot.docs ?? []).map((item) => ({ id: item.id, ...item.data() }));
const textField = (value) => typeof value === "string" ? value.trim() : "";
const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(400, `${label} invalide.`);
  return value.trim();
};
const chunks = (values) => Array.from({ length: Math.ceil(values.length / 30) }, (_, index) => values.slice(index * 30, index * 30 + 30));
const inSections = (sections, section) => !sections.length || sections.includes(comparableSection(section));
const teacherLabel = (teacher) => textField(teacher?.fullName) || `${textField(teacher?.lastName)} ${textField(teacher?.firstName)}`.trim() || "Enseignant";
const activeProfile = (profile, role, schoolId) => profile?.role === role && profile?.schoolId === schoolId && profile?.active !== false && profile?.status !== "inactive";

/** Lit le compte, l'école et l'année ; refuse tout compte qui n'a pas un des rôles demandés. */
export async function requireSchoolActor(db, caller, schoolId, schoolYearId, roles, deniedMessage = "Accès réservé aux conseillers.") {
  if (!roles.includes(caller?.role) || caller.schoolId !== schoolId) fail(403, deniedMessage);
  const [user, school, year] = await Promise.all([
    db.doc(`users/${caller.uid}`).get(), db.doc(`schools/${schoolId}`).get(), db.doc(`schoolYears/${schoolYearId}`).get(),
  ]);
  const profile = user.data();
  if (!user.exists || !activeProfile(profile, caller.role, schoolId)) fail(403, deniedMessage);
  if (!school.exists || ["suspended", "inactive", "deleting"].includes(school.data()?.status) || !year.exists || year.data()?.schoolId !== schoolId) {
    fail(403, "École ou année scolaire invalide.");
  }
  // Seuls l'administrateur de l'école et les conseillers ne suivent pas forcément des sections :
  // un administrateur agit toujours pour toute l'école.
  const sections = caller.role === "school_admin" || caller.role === "admin" ? [] : authoritySections(profile, school.data());
  return { profile, school: school.data(), sections };
}

/** Calcul pur : enseignants des sections, leurs cours (lecture seule) et les compteurs du Dashboard. */
export function computeAdvisorOverview({ sections, teachers, teacherUsers = [], classes, subjects, assignments }) {
  const scopedClasses = new Map(classes.filter((item) => item.active !== false && inSections(sections, item.section)).map((item) => [item.id, item]));
  const classSectionById = new Map(classes.map((item) => [item.id, comparableSection(item.section)]));
  const subjectName = new Map(subjects.map((item) => [item.id, textField(item.name)]));
  const userById = new Map(teacherUsers.map((item) => [item.id, item]));
  const activeAssignments = assignments.filter((item) => item.active !== false && scopedClasses.has(item.classId));
  const rows = teachers.filter((teacher) => teacher.status !== "inactive" && !teacher.deletedAt)
    .filter((teacher) => teacherInSections({ sections, teacherId: teacher.id, teacher, teacherUser: userById.get(teacher.userId), assignments, classSectionById }))
    .map((teacher) => {
      const courses = activeAssignments.filter((item) => item.teacherId === teacher.id).map((item) => ({
        classId: item.classId, subjectId: item.subjectId,
        subjectName: subjectName.get(item.subjectId) || "Cours",
        className: textField(scopedClasses.get(item.classId)?.name) || "Classe",
        weeklyPeriods: Number.isFinite(item.weeklyPeriods) && item.weeklyPeriods > 0 ? item.weeklyPeriods : 0,
      })).sort((a, b) => a.className.localeCompare(b.className, "fr") || a.subjectName.localeCompare(b.subjectName, "fr"));
      return { id: teacher.id, teacherName: teacherLabel(teacher), courses, weeklyPeriods: courses.reduce((sum, course) => sum + course.weeklyPeriods, 0) };
    }).sort((a, b) => a.teacherName.localeCompare(b.teacherName, "fr"));
  const classesList = [...scopedClasses.values()].map((item) => ({ id: item.id, name: textField(item.name) || "Classe", section: comparableSection(item.section) ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return {
    sections: [...sections],
    teachers: rows,
    classes: classesList,
    metrics: {
      teachers: rows.length,
      assignments: activeAssignments.length,
      subjects: new Set(activeAssignments.map((item) => item.subjectId)).size,
      workload: rows.reduce((sum, row) => sum + row.weeklyPeriods, 0),
      teachersWithoutAssignment: rows.filter((row) => row.courses.length === 0).length,
    },
  };
}

/** Calcul pur : élèves des sections, SANS aucune donnée d'argent (liste blanche de champs). */
export function computeAdvisorStudents({ sections, students }) {
  return students.filter((student) => !student.deletedAt && inSections(sections, student.section))
    .map((student) => ({
      id: student.id,
      name: textField(student.fullName) || `${textField(student.lastName)} ${textField(student.firstName)}`.trim() || textField(student.name) || "Élève",
      matricule: textField(student.matricule),
      className: textField(student.className),
      section: comparableSection(student.section) ?? textField(student.section),
      gender: textField(student.gender),
      status: textField(student.status) || "ACTIVE",
    }))
    .sort((a, b) => a.className.localeCompare(b.className, "fr") || a.name.localeCompare(b.name, "fr"));
}

/** Bulletins consolidés des classes des sections (une classe incomplète est ignorée). */
export function advisorReports({ sections, students, classes, subjects, assignments, configs, entries }) {
  const scopedStudents = students.filter((student) => !student.deletedAt && (student.status ?? "ACTIVE") === "ACTIVE" && inSections(sections, student.section));
  const reports = [];
  for (const schoolClass of classes.filter((item) => item.active !== false && inSections(sections, item.section))) {
    try {
      const report = calculateConsolidatedReport({ classId: schoolClass.id, students: scopedStudents, classes, subjects, assignments, configs, entries });
      if (report.students.length) reports.push({ schoolClass, report });
    } catch {
      // Une classe incomplète ne bloque pas la lecture des autres.
    }
  }
  return reports;
}

/** Calcul pur : cotes en lecture, par classe et par période (moyenne de la classe, nombre d'élèves évalués). */
export function computeAdvisorGrades(input) {
  const classesOut = advisorReports(input).map(({ schoolClass, report }) => ({
    classId: schoolClass.id,
    className: textField(schoolClass.name) || "Classe",
    section: comparableSection(schoolClass.section) ?? "",
    students: report.students.length,
    slots: GRADE_SLOTS.map((slot) => {
      const complete = report.students.filter((row) => row.evaluations[slot]?.complete);
      return {
        slot, label: SLOT_LABELS[slot], evaluated: complete.length,
        average: complete.length ? Math.round(complete.reduce((sum, row) => sum + row.evaluations[slot].percentage, 0) / complete.length * 10) / 10 : null,
      };
    }).filter((item) => item.evaluated > 0),
  })).sort((a, b) => a.className.localeCompare(b.className, "fr"));
  return { sections: [...input.sections], classes: classesOut };
}

async function loadGradingSources(db, schoolId, schoolYearId, sections) {
  const scoped = (name) => db.collection(name).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const [students, classes, subjects, assignments] = await Promise.all([
    scoped("students").get().then(serialize),
    scoped("classes").get().then(serialize),
    scoped("subjects").get().then(serialize),
    scoped("pedagogicalAssignments").where("active", "==", true).get().then(serialize),
  ]);
  const classIds = classes.filter((item) => inSections(sections, item.section)).map((item) => item.id);
  const byClass = async (name) => (await Promise.all(chunks(classIds).map((part) => scoped(name).where("classId", "in", part).get()))).flatMap(serialize);
  const [configs, entries] = classIds.length ? await Promise.all([byClass("courseGradingConfigs"), byClass("gradeEntries")]) : [[], []];
  return { students, classes, subjects, assignments, configs, entries };
}

export async function loadAdvisorOverview({ db, caller, body }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, [PEDAGOGICAL_ADVISOR]);
  const scoped = (name) => db.collection(name).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const [teachers, teacherUsers, classes, subjects, assignments] = await Promise.all([
    scoped("teachers").get().then(serialize),
    db.collection("users").where("schoolId", "==", schoolId).where("role", "==", "teacher").get().then(serialize),
    scoped("classes").get().then(serialize),
    scoped("subjects").get().then(serialize),
    scoped("pedagogicalAssignments").where("active", "==", true).get().then(serialize),
  ]);
  return computeAdvisorOverview({ sections, teachers, teacherUsers, classes, subjects, assignments });
}

export async function listAdvisorStudents({ db, caller, body, roles = ADVISOR_ROLES }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, roles);
  const students = serialize(await db.collection("students").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get());
  return { sections: [...sections], students: computeAdvisorStudents({ sections, students }) };
}

export async function loadAdvisorGrades({ db, caller, body }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, [PEDAGOGICAL_ADVISOR]);
  return computeAdvisorGrades({ sections, ...await loadGradingSources(db, schoolId, schoolYearId, sections) });
}

// ---------- Fiches de visite de classe (lot 10) ----------
// Écrites par le Conseiller pédagogique (ses fiches seulement) ; lues par lui, par la Direction des études
// (fiches de ses sections, règle unique) et par l'administrateur de l'école. Collection fermée au navigateur.
export const VISIT_READER_ROLES = [PEDAGOGICAL_ADVISOR, "study_director", "school_admin", "admin"];
const date = (value, label, optional = false) => {
  const raw = textField(value);
  if (!raw && optional) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) fail(400, `${label} invalide.`);
  return raw;
};
const longText = (value, label) => {
  const raw = textField(value);
  if (raw.length > MAX_TEXT) fail(400, `${label} : ${MAX_TEXT} caractères au plus.`);
  return raw;
};

/** Calcul pur : contrôle et nettoie le contenu d'une fiche envoyée par l'écran. */
export function normalizeVisitInput(input = {}) {
  const visit = {
    classId: required(input.classId, "Classe"),
    teacherId: textField(input.teacherId),
    subjectId: textField(input.subjectId),
    visitDate: date(input.visitDate, "Date de la visite"),
    strengths: longText(input.strengths, "Points forts"),
    improvements: longText(input.improvements, "À améliorer"),
    advice: longText(input.advice, "Conseils"),
    nextVisitDate: date(input.nextVisitDate, "Date de la prochaine visite", true),
  };
  if (!visit.strengths && !visit.improvements && !visit.advice) fail(400, "Écrivez au moins un point fort, un point à améliorer ou un conseil.");
  return visit;
}

/** Calcul pur : fiches visibles par un compte. */
export function visibleVisits({ role, uid, sections, visits }) {
  return visits.filter((visit) => {
    if (role === PEDAGOGICAL_ADVISOR) return visit.authorId === uid;
    if (role === "study_director") return inSections(sections, visit.section);
    return role === "school_admin" || role === "admin";
  }).sort((a, b) => String(b.visitDate ?? "").localeCompare(String(a.visitDate ?? "")) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

const visitView = (visit) => ({
  id: visit.id, classId: visit.classId, className: visit.className, section: visit.section,
  teacherId: visit.teacherId ?? "", teacherName: visit.teacherName ?? "", subjectId: visit.subjectId ?? "", subjectName: visit.subjectName ?? "",
  visitDate: visit.visitDate, strengths: visit.strengths ?? "", improvements: visit.improvements ?? "", advice: visit.advice ?? "",
  nextVisitDate: visit.nextVisitDate ?? "", authorId: visit.authorId, authorName: visit.authorName ?? "", createdAt: visit.createdAt, updatedAt: visit.updatedAt,
});

export async function listClassVisits({ db, caller, body }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, VISIT_READER_ROLES, "Fiches de visite non autorisées.");
  let query = db.collection("classVisits").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  if (caller.role === PEDAGOGICAL_ADVISOR) query = query.where("authorId", "==", caller.uid);
  const visits = serialize(await query.get());
  return { visits: visibleVisits({ role: caller.role, uid: caller.uid, sections, visits }).map(visitView) };
}

export async function saveClassVisit({ db, caller, body, now = () => new Date().toISOString() }) {
  const schoolId = required(body.schoolId, "École"), schoolYearId = required(body.schoolYearId, "Année scolaire");
  const { profile, sections } = await requireSchoolActor(db, caller, schoolId, schoolYearId, [PEDAGOGICAL_ADVISOR], "Seul le Conseiller pédagogique écrit les fiches de visite.");
  await requireActiveSchoolYear(db, schoolId, schoolYearId).catch((error) => fail(error?.statusCode === 409 ? 409 : 400, error?.message || "Année scolaire invalide."));
  const input = normalizeVisitInput(body.visit);
  const [classSnap, teacherSnap, subjectSnap] = await Promise.all([
    db.doc(`classes/${input.classId}`).get(),
    input.teacherId ? db.doc(`teachers/${input.teacherId}`).get() : Promise.resolve(null),
    input.subjectId ? db.doc(`subjects/${input.subjectId}`).get() : Promise.resolve(null),
  ]);
  const schoolClass = classSnap.exists ? classSnap.data() : undefined;
  if (!schoolClass || schoolClass.schoolId !== schoolId || schoolClass.schoolYearId !== schoolYearId) fail(400, "Classe introuvable dans cette année scolaire.");
  if (!inSections(sections, schoolClass.section)) fail(403, "Cette classe n'est pas dans vos sections.");
  const teacher = teacherSnap?.exists ? teacherSnap.data() : undefined;
  if (input.teacherId && (!teacher || teacher.schoolId !== schoolId || teacher.schoolYearId !== schoolYearId)) fail(400, "Enseignant introuvable dans cette année scolaire.");
  const subject = subjectSnap?.exists ? subjectSnap.data() : undefined;
  if (input.subjectId && (!subject || subject.schoolId !== schoolId || subject.schoolYearId !== schoolYearId)) fail(400, "Cours introuvable dans cette année scolaire.");
  const stamp = now();
  const content = {
    ...input,
    className: textField(schoolClass.name) || "Classe",
    section: comparableSection(schoolClass.section) ?? textField(schoolClass.section),
    teacherName: teacher ? teacherLabel(teacher) : "",
    subjectName: subject ? textField(subject.name) : "",
    updatedAt: stamp,
  };
  const visitId = textField(body.visitId);
  if (!visitId) {
    const ref = db.collection("classVisits").doc();
    const visit = { ...content, schoolId, schoolYearId, authorId: caller.uid, authorName: textField(profile?.name) || "Conseiller pédagogique", createdAt: stamp };
    await ref.set(visit);
    return { visit: visitView({ id: ref.id, ...visit }) };
  }
  const ref = db.doc(`classVisits/${visitId}`);
  const saved = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() : undefined;
    if (!current || current.schoolId !== schoolId || current.schoolYearId !== schoolYearId) fail(404, "Fiche de visite introuvable.");
    if (current.authorId !== caller.uid) fail(403, "Vous ne pouvez modifier que vos propres fiches.");
    const next = { ...current, ...content };
    transaction.set(ref, next);
    return next;
  });
  return { visit: visitView({ id: visitId, ...saved }) };
}
