import { FieldValue } from "firebase-admin/firestore";

const EDITABLE_SLOTS = new Set([
  "period_1", "period_2", "semester_1_exam",
  "period_3", "period_4", "semester_2_exam",
]);

export class GradingApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const requiredString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new GradingApiError(400, "invalid-argument", `${label} invalide.`);
  }
  return value.trim();
};

const serialize = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

async function identity(db, caller, schoolId, schoolYearId) {
  if (caller.role !== "teacher" || caller.schoolId !== schoolId) {
    throw new GradingApiError(403, "permission-denied", "Accès Enseignant non autorisé.");
  }
  const [user, profiles, year] = await Promise.all([
    db.doc(`users/${caller.uid}`).get(),
    db.collection("teachers").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("userId", "==", caller.uid).get(),
    db.doc(`schoolYears/${schoolYearId}`).get(),
  ]);
  const profile = profiles.docs[0];
  if (!user.exists || user.data()?.status === "inactive" || user.data()?.active === false || profiles.size !== 1 || profile.data().status === "inactive" || !year.exists || year.data()?.schoolId !== schoolId) {
    throw new GradingApiError(403, "permission-denied", "Profil pédagogique actif introuvable.");
  }
  return profile;
}

async function scope(db, teacher, schoolId, schoolYearId) {
  const [assignmentSnapshot, titularSnapshot] = await Promise.all([
    db.collection("pedagogicalAssignments").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("teacherId", "==", teacher.id).where("active", "==", true).get(),
    db.collection("classTitulars").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("teacherId", "==", teacher.id).get(),
  ]);
  return {
    assignments: serialize(assignmentSnapshot),
    titulars: serialize(titularSnapshot).filter((item) => item.active !== false),
  };
}

async function assertCourse(db, teacher, schoolId, schoolYearId, classId, subjectId, assignmentId) {
  const { assignments } = await scope(db, teacher, schoolId, schoolYearId);
  const assignment = assignments.find((item) => item.id === assignmentId && item.classId === classId && item.subjectId === subjectId);
  if (!assignment) throw new GradingApiError(403, "permission-denied", "Cours hors du périmètre pédagogique.");
  return assignment;
}

async function scopedDocuments(db, collection, schoolId, schoolYearId, assignments, titularClassIds) {
  const snapshots = await Promise.all([
    ...assignments.map(({ classId, subjectId }) => db.collection(collection).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("classId", "==", classId).where("subjectId", "==", subjectId).get()),
    ...titularClassIds.map((classId) => db.collection(collection).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("classId", "==", classId).get()),
  ]);
  return [...new Map(snapshots.flatMap(serialize).map((item) => [item.id, item])).values()];
}

async function loadGrading(db, teacher, schoolId, schoolYearId) {
  const { assignments, titulars } = await scope(db, teacher, schoolId, schoolYearId);
  const classIds = [...new Set([...assignments.map((item) => item.classId), ...titulars.map((item) => item.classId)])];
  const titularClassIds = [...new Set(titulars.map((item) => item.classId))];
  const [subjects, classes, configs, entries] = await Promise.all([
    db.collection("subjects").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
    db.collection("classes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
    scopedDocuments(db, "courseGradingConfigs", schoolId, schoolYearId, assignments, titularClassIds),
    scopedDocuments(db, "gradeEntries", schoolId, schoolYearId, assignments, titularClassIds),
  ]);
  const students = [];
  for (const classId of classIds) {
    for (const field of ["classId", "subClassId"]) {
      const found = await db.collection("students").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where(field, "==", classId).get();
      students.push(...serialize(found).filter((item) => (item.status ?? "ACTIVE") === "ACTIVE" && !item.deletedAt));
    }
  }
  const allowedSubjectIds = new Set(assignments.map((item) => item.subjectId));
  return {
    teacher: { id: teacher.id, ...teacher.data() }, assignments, titulars,
    subjects: serialize(subjects).filter((item) => allowedSubjectIds.has(item.id) || titularClassIds.length > 0),
    classes: serialize(classes).filter((item) => classIds.includes(item.id)),
    students: [...new Map(students.map((item) => [item.id, item])).values()],
    configs, entries,
  };
}

export async function executeTeacherGrading({ db, caller, body }) {
  const action = requiredString(body.action, "Action");
  const schoolId = requiredString(body.schoolId, "École");
  const schoolYearId = requiredString(body.schoolYearId, "Année scolaire");
  const teacher = await identity(db, caller, schoolId, schoolYearId);
  if (action === "load") return loadGrading(db, teacher, schoolId, schoolYearId);

  const classId = requiredString(body.classId, "Classe");
  const subjectId = requiredString(body.subjectId, "Matière");
  const assignmentId = requiredString(body.assignmentId, "Affectation");
  await assertCourse(db, teacher, schoolId, schoolYearId, classId, subjectId, assignmentId);
  const configId = [schoolId, schoolYearId, classId, subjectId].join("__");

  if (action === "save-config") {
    const maxScore = Number(body.maxScore);
    if (!Number.isFinite(maxScore) || maxScore <= 0) throw new GradingApiError(400, "invalid-argument", "La cote maximale doit être supérieure à zéro.");
    const existing = await db.collection("gradeEntries").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("classId", "==", classId).where("subjectId", "==", subjectId).get();
    if (existing.docs.some((item) => item.data().status === "graded" && Number(item.data().score) > maxScore)) {
      throw new GradingApiError(409, "failed-precondition", `La cote maximale ne peut pas être abaissée à ${maxScore} car certaines cotes existantes dépassent cette valeur.`);
    }
    const ref = db.doc(`courseGradingConfigs/${configId}`);
    const previous = await ref.get();
    const now = FieldValue.serverTimestamp();
    await ref.set({ id: configId, schoolId, schoolYearId, assignmentId, teacherId: teacher.id, classId, subjectId, maxScore, status: "draft", createdAt: previous.exists ? previous.data().createdAt : now, createdBy: previous.exists ? previous.data().createdBy : caller.uid, updatedAt: now, updatedBy: caller.uid });
    return { ok: true, id: configId };
  }

  if (action === "save-entries") {
    const config = await db.doc(`courseGradingConfigs/${configId}`).get();
    if (!config.exists) throw new GradingApiError(409, "failed-precondition", "Définissez la cote maximale de ce cours avant de commencer la cotation.");
    const maxScore = Number(config.data().maxScore);
    const items = Array.isArray(body.entries) ? body.entries : [];
    if (items.length > 500) throw new GradingApiError(400, "invalid-argument", "Trop de cotes.");
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const item of items) {
      const studentId = requiredString(item.studentId, "Élève");
      const slot = requiredString(item.gradingSlot, "Période");
      const status = item.status;
      if (!EDITABLE_SLOTS.has(slot) || !["graded", "not_graded", "absent"].includes(status)) throw new GradingApiError(400, "invalid-argument", "Cotation invalide.");
      const student = await db.doc(`students/${studentId}`).get();
      const studentClass = student.data()?.subClassId ?? student.data()?.classId;
      if (!student.exists || student.data()?.schoolId !== schoolId || student.data()?.schoolYearId !== schoolYearId || studentClass !== classId || (student.data()?.status ?? "ACTIVE") !== "ACTIVE" || student.data()?.deletedAt) {
        throw new GradingApiError(403, "permission-denied", "Élève hors du périmètre autorisé.");
      }
      const score = status === "graded" ? Number(item.score) : null;
      if (status === "graded" && (!Number.isFinite(score) || score < 0 || score > maxScore)) throw new GradingApiError(400, "invalid-argument", `La cote doit être comprise entre 0 et ${maxScore}.`);
      const id = [schoolId, schoolYearId, classId, subjectId, studentId, slot].join("__");
      const ref = db.doc(`gradeEntries/${id}`);
      const previous = await ref.get();
      batch.set(ref, { id, schoolId, schoolYearId, assignmentId, teacherId: previous.exists ? previous.data().teacherId : teacher.id, classId, subjectId, studentId, gradingSlot: slot, score, status, maxScoreSnapshot: maxScore, createdAt: previous.exists ? previous.data().createdAt : now, createdBy: previous.exists ? previous.data().createdBy : caller.uid, updatedAt: now, updatedBy: caller.uid });
    }
    await batch.commit();
    return { ok: true, count: items.length };
  }
  throw new GradingApiError(400, "invalid-argument", "Action non prise en charge.");
}
