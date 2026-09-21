import { FieldValue } from "firebase-admin/firestore";
import { canonicalClassNameFromRecordId, operationalBaseClassId, operationalClassOptionKey } from "../../src/utils/studentYearTransition.js";

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
const normalized = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");
const classBaseId = (schoolClass) => operationalBaseClassId(schoolClass);
const assignmentOptionIds = (assignment, schoolClass) => {
  const explicit = [...new Set((assignment.targetOptionIds ?? []).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
  if (assignment.courseScope && explicit.length > 0) return explicit;
  const historical = operationalClassOptionKey(schoolClass) || (schoolClass?.option?.trim() && schoolClass?.parentClassId ? schoolClass.id : undefined);
  return historical ? [historical] : [];
};

export function studentMatchesAssignment(student, assignment, schoolClass, parentClass) {
  if (!student || (student.status ?? "ACTIVE") !== "ACTIVE" || student.deletedAt) return false;
  if (assignment.schoolId && student.schoolId !== assignment.schoolId) return false;
  if (assignment.schoolYearId && student.schoolYearId !== assignment.schoolYearId) return false;
  if (schoolClass?.subClassLabel && student.subClassId !== schoolClass.id) return false;
  const baseId = classBaseId(schoolClass) || assignment.classId;
  const canonicalBaseName = canonicalClassNameFromRecordId(baseId);
  const optionBaseId = typeof student.classOptionKey === "string" ? student.classOptionKey.split("::")[0]?.trim() : undefined;
  const sameBase = student.classId === baseId
    || student.subClassId === assignment.classId
    || optionBaseId === baseId
    || normalized(student.className) === normalized(parentClass?.name ?? schoolClass?.name)
    || Boolean(canonicalBaseName && normalized(student.className) === normalized(canonicalBaseName));
  if (!sameBase) return false;
  const targets = assignmentOptionIds(assignment, schoolClass);
  if (targets.length === 0) return true;
  if (typeof student.classOptionKey === "string" && targets.includes(student.classOptionKey.trim())) return true;
  const studentOption = normalized(student.option);
  return Boolean(studentOption && (
    normalized(schoolClass?.option) === studentOption
    || targets.some((target) => normalized(target.split("::").at(-1)) === studentOption)
  ));
}

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

async function queryInChunks(db, collection, schoolId, schoolYearId, field, values) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  const chunks = Array.from({ length: Math.ceil(uniqueValues.length / 30) }, (_, index) => uniqueValues.slice(index * 30, index * 30 + 30));
  const snapshots = await Promise.all(chunks.map((chunk) => db.collection(collection).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where(field, "in", chunk).get()));
  return snapshots.flatMap(serialize);
}

async function scopedDocuments(db, collection, schoolId, schoolYearId, assignments, titularClassIds) {
  const assignmentPairs = new Set(assignments.map(({ classId, subjectId }) => `${classId}::${subjectId}`));
  const classIds = [...new Set([...assignments.map((item) => item.classId), ...titularClassIds])];
  const items = await queryInChunks(db, collection, schoolId, schoolYearId, "classId", classIds);
  return [...new Map(items.filter((item) => titularClassIds.includes(item.classId) || assignmentPairs.has(`${item.classId}::${item.subjectId}`)).map((item) => [item.id, item])).values()];
}

async function loadGrading(db, teacher, schoolId, schoolYearId) {
  const { assignments, titulars } = await scope(db, teacher, schoolId, schoolYearId);
  if (assignments.length === 0 && titulars.length === 0) {
    return {
      teacher: { id: teacher.id, ...teacher.data() }, assignments, titulars,
      subjects: [], classes: [], students: [], configs: [], entries: [],
    };
  }
  const classIds = [...new Set([...assignments.map((item) => item.classId), ...titulars.map((item) => item.classId)])];
  const titularClassIds = [...new Set(titulars.map((item) => item.classId))];
  const [subjects, classes, configs, entries] = await Promise.all([
    db.collection("subjects").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
    db.collection("classes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
    scopedDocuments(db, "courseGradingConfigs", schoolId, schoolYearId, assignments, titularClassIds),
    scopedDocuments(db, "gradeEntries", schoolId, schoolYearId, assignments, titularClassIds),
  ]);
  const classRows = serialize(classes);
  const schoolClassById = new Map(classRows.map((item) => [item.id, item]));
  const assignedClasses = classIds.map((id) => schoolClassById.get(id)).filter(Boolean);
  const baseClassIds = [...new Set(assignedClasses.map(classBaseId).filter(Boolean))];
  const candidateClassIds = [...new Set([...classIds, ...baseClassIds])];
  const optionIds = [...new Set(assignments.flatMap((assignment) => assignmentOptionIds(assignment, schoolClassById.get(assignment.classId))))];
  const classNames = [...new Set(assignedClasses.flatMap((item) => [item.name, schoolClassById.get(classBaseId(item))?.name, canonicalClassNameFromRecordId(classBaseId(item))]).filter(Boolean))];
  const [classStudents, subclassStudents, namedStudents, optionStudents] = titularClassIds.length === 0 ? [[], [], [], []] : await Promise.all([
    queryInChunks(db, "students", schoolId, schoolYearId, "classId", candidateClassIds),
    queryInChunks(db, "students", schoolId, schoolYearId, "subClassId", classIds),
    queryInChunks(db, "students", schoolId, schoolYearId, "className", classNames),
    queryInChunks(db, "students", schoolId, schoolYearId, "classOptionKey", optionIds),
  ]);
  const students = [...new Map([...classStudents, ...subclassStudents, ...namedStudents, ...optionStudents].filter((student) =>
    assignments.some((assignment) => { const schoolClass = schoolClassById.get(assignment.classId); return studentMatchesAssignment(student, assignment, schoolClass, schoolClassById.get(classBaseId(schoolClass))); })
    || titularClassIds.some((classId) => { const schoolClass = schoolClassById.get(classId); return studentMatchesAssignment(student, { classId, schoolId, schoolYearId }, schoolClass, schoolClassById.get(classBaseId(schoolClass))); }),
  ).map((item) => [item.id, item])).values()];
  const allowedSubjectIds = new Set(assignments.map((item) => item.subjectId));
  return {
    teacher: { id: teacher.id, ...teacher.data() }, assignments, titulars,
    subjects: serialize(subjects).filter((item) => allowedSubjectIds.has(item.id) || titularClassIds.length > 0),
    classes: classRows.filter((item) => candidateClassIds.includes(item.id)),
    students: [...new Map(students.map((item) => [item.id, item])).values()],
    configs, entries,
  };
}

async function parentUsersForIds(db, schoolId, parentIds) {
  const chunks = Array.from({ length: Math.ceil(parentIds.length / 30) }, (_, index) => parentIds.slice(index * 30, index * 30 + 30));
  const snapshots = await Promise.all(chunks.map((chunk) => db.collection("users").where("schoolId", "==", schoolId).where("parentId", "in", chunk).get()));
  return snapshots.flatMap(serialize);
}

async function saveObservation(db, caller, teacher, assignment, schoolId, schoolYearId, body) {
  const studentId = requiredString(body.studentId, "Élève");
  const observation = requiredString(body.observation, "Observation");
  if (observation.length > 2000) throw new GradingApiError(400, "invalid-argument", "L’observation ne peut pas dépasser 2 000 caractères.");
  const [studentSnapshot, classSnapshot] = await Promise.all([
    db.doc(`students/${studentId}`).get(),
    db.doc(`classes/${assignment.classId}`).get(),
  ]);
  const schoolClass = classSnapshot.exists ? { id: classSnapshot.id ?? assignment.classId, ...classSnapshot.data() } : undefined;
  const baseId = classBaseId(schoolClass);
  const parentClassSnapshot = baseId && baseId !== assignment.classId ? await db.doc(`classes/${baseId}`).get() : undefined;
  const parentClass = parentClassSnapshot?.exists ? { id: parentClassSnapshot.id ?? baseId, ...parentClassSnapshot.data() } : undefined;
  if (!studentSnapshot.exists || studentSnapshot.data()?.schoolId !== schoolId || studentSnapshot.data()?.schoolYearId !== schoolYearId || !studentMatchesAssignment(studentSnapshot.data(), assignment, schoolClass, parentClass)) {
    throw new GradingApiError(403, "permission-denied", "Élève hors du périmètre autorisé.");
  }
  const observationId = [schoolId, schoolYearId, teacher.id, assignment.id, studentId].join("__");
  const observationRef = db.doc(`teacherStudentObservations/${observationId}`);
  const previous = await observationRef.get();
  const now = new Date().toISOString();
  const payload = {
    id: observationId, schoolId, schoolYearId, teacherId: teacher.id, assignmentId: assignment.id,
    classId: assignment.classId, subjectId: assignment.subjectId, studentId, observation,
    createdAt: previous.exists ? previous.data().createdAt : now,
    createdBy: previous.exists ? previous.data().createdBy : caller.uid,
    updatedAt: now, updatedBy: caller.uid,
  };
  await observationRef.set(payload);

  const directParentId = typeof studentSnapshot.data()?.parentId === "string" ? studentSnapshot.data().parentId.trim() : "";
  const linkedParents = await db.collection("parents").where("schoolId", "==", schoolId).where("studentIds", "array-contains", studentId).get();
  const parentIds = [...new Set([directParentId, ...linkedParents.docs.map((item) => item.id)].filter(Boolean))];
  let notificationCount = 0;
  let notificationWarning = "";
  if (parentIds.length) {
    try {
      const parentUsers = await parentUsersForIds(db, schoolId, parentIds);
      const recipients = parentUsers.filter((item) => item.role === "parent" && item.status !== "inactive" && item.active !== false && parentIds.includes(item.parentId));
      if (recipients.length) {
        const batch = db.batch();
        const student = studentSnapshot.data();
        const studentName = [student.nom, student.postnom, student.prenom].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || "cet élève";
        recipients.forEach((recipient) => {
          const id = `${observationId}__${recipient.id}`;
          batch.set(db.doc(`notifications/${id}`), {
            id, schoolId, schoolYearId, recipientRole: "parent", recipientUserId: recipient.id,
            parentId: recipient.parentId, studentId, studentName, type: "observation",
            title: "Nouvelle observation pédagogique",
            body: `Une nouvelle observation pédagogique concernant ${studentName} a été enregistrée par son enseignant.`,
            createdAt: now, read: false,
          });
        });
        await batch.commit();
        notificationCount = recipients.length;
      }
    } catch (error) {
      notificationWarning = "L’observation est enregistrée, mais la notification parent n’a pas pu être envoyée.";
    }
  }
  return { ok: true, observation: payload, notificationCount, notificationWarning };
}

async function loadCourseRoster(db, assignment, schoolId, schoolYearId) {
  const classSnapshot = await db.doc(`classes/${assignment.classId}`).get();
  const schoolClass = classSnapshot.exists ? { id: classSnapshot.id ?? assignment.classId, ...classSnapshot.data() } : undefined;
  if (!classSnapshot.exists || schoolClass?.schoolId !== schoolId || schoolClass?.schoolYearId !== schoolYearId) {
    throw new GradingApiError(403, "permission-denied", "Classe hors du périmètre pédagogique.");
  }
  const baseId = classBaseId(schoolClass);
  const parentSnapshot = baseId && baseId !== assignment.classId ? await db.doc(`classes/${baseId}`).get() : undefined;
  const parentClass = parentSnapshot?.exists ? { id: parentSnapshot.id ?? baseId, ...parentSnapshot.data() } : undefined;
  const optionIds = assignmentOptionIds(assignment, schoolClass);
  const [classStudents, subclassStudents, namedStudents, optionStudents] = await Promise.all([
    queryInChunks(db, "students", schoolId, schoolYearId, "classId", [assignment.classId, baseId]),
    queryInChunks(db, "students", schoolId, schoolYearId, "subClassId", [assignment.classId]),
    queryInChunks(db, "students", schoolId, schoolYearId, "className", [schoolClass.name, parentClass?.name, canonicalClassNameFromRecordId(baseId)]),
    queryInChunks(db, "students", schoolId, schoolYearId, "classOptionKey", optionIds),
  ]);
  const students = [...new Map([...classStudents, ...subclassStudents, ...namedStudents, ...optionStudents]
    .filter((student) => studentMatchesAssignment(student, assignment, schoolClass, parentClass))
    .map((student) => [student.id, student])).values()];
  return { assignmentId: assignment.id, students };
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
  const assignment = await assertCourse(db, teacher, schoolId, schoolYearId, classId, subjectId, assignmentId);
  if (action === "load-roster") return loadCourseRoster(db, assignment, schoolId, schoolYearId);
  if (action === "save-observation") return saveObservation(db, caller, teacher, assignment, schoolId, schoolYearId, body);
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
    const schoolClass = await db.doc(`classes/${classId}`).get();
    const schoolClassData = schoolClass.exists ? { id: schoolClass.id ?? classId, ...schoolClass.data() } : undefined;
    const baseId = classBaseId(schoolClassData);
    const parentClass = baseId && baseId !== classId ? await db.doc(`classes/${baseId}`).get() : undefined;
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    for (const item of items) {
      const studentId = requiredString(item.studentId, "Élève");
      const slot = requiredString(item.gradingSlot, "Période");
      const status = item.status;
      if (!EDITABLE_SLOTS.has(slot) || !["graded", "not_graded", "absent"].includes(status)) throw new GradingApiError(400, "invalid-argument", "Cotation invalide.");
      const student = await db.doc(`students/${studentId}`).get();
      if (!student.exists || student.data()?.schoolId !== schoolId || student.data()?.schoolYearId !== schoolYearId || !studentMatchesAssignment(student.data(), assignment, schoolClassData, parentClass?.data())) {
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
