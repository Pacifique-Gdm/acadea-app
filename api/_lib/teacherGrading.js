import { FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { canonicalClassNameFromRecordId, operationalBaseClassId, operationalClassOptionKey } from "../../src/utils/studentYearTransition.js";

const EDITABLE_SLOTS = new Set([
  "period_1", "period_2", "semester_1_exam",
  "period_3", "period_4", "semester_2_exam",
]);
const slotConfigId = (schoolId, schoolYearId, classId, subjectId, slot) => `maxv2__${[schoolId, schoolYearId, classId, subjectId, slot].map((part) => `${part.length}:${part}`).join("")}`;
const activityLog = ({ id, schoolId, schoolYearId, actorId, actorName, action, details, resourceType, resourceId, createdAt }) => ({
  id, schoolId, schoolYearId, subjectUserId: actorId, actorId, actorName: actorName || "Enseignant", actorRole: "teacher",
  action, details, resourceType, resourceId, createdAt, source: "server",
});
async function courseActivityLabel(db, schoolId, schoolYearId, classId, subjectId) {
  const [schoolClass, subject] = await Promise.all([db.doc(`classes/${classId}`).get(), db.doc(`subjects/${subjectId}`).get()]);
  const className = schoolClass.exists && schoolClass.data()?.schoolId === schoolId && schoolClass.data()?.schoolYearId === schoolYearId ? schoolClass.data()?.name : "Classe concernée";
  const subjectName = subject.exists && subject.data()?.schoolId === schoolId && subject.data()?.schoolYearId === schoolYearId ? subject.data()?.name : "Matière concernée";
  return `Classe : ${className || "Classe concernée"} · Matière : ${subjectName || "Matière concernée"}`;
}

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

const snapshotVersion = (snapshot) => snapshot?.exists && snapshot.updateTime
  ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;
const validVersion = (value) => typeof value === "string" && /^\d{1,12}:\d{1,9}$/.test(value);

async function syncOfflineGrade(db, caller, teacher, assignment, schoolId, schoolYearId, classId, subjectId, slot, body) {
  const operationId = requiredString(body.operationId, "Opération locale");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new GradingApiError(400, "invalid-argument", "Identifiant d'opération locale invalide.");
  }
  const studentId = requiredString(body.studentId, "Élève");
  const status = body.status;
  if (!["graded", "not_graded", "absent"].includes(status)) throw new GradingApiError(400, "invalid-argument", "Statut de cote invalide.");
  if (body.expectedGradeVersion !== null && !validVersion(body.expectedGradeVersion)) {
    throw new GradingApiError(400, "invalid-argument", "Version de cote invalide.");
  }
  if (!validVersion(body.expectedMaximumVersion)) throw new GradingApiError(400, "invalid-argument", "Version du maximum absente.");
  const submittedMaximum = Number(body.maximumAtCapture);
  if (!Number.isFinite(submittedMaximum) || submittedMaximum <= 0) throw new GradingApiError(400, "invalid-argument", "Maximum local invalide.");
  const score = status === "graded" && body.score !== null && body.score !== undefined && body.score !== "" ? Number(body.score) : null;
  if (status === "graded" ? score === null || !Number.isFinite(score) || score < 0 : body.score !== null) {
    throw new GradingApiError(400, "invalid-argument", "Cote locale invalide.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ schoolId, schoolYearId, assignmentId: assignment.id,
    classId, subjectId, slot, studentId, status, score, expectedGradeVersion: body.expectedGradeVersion,
    expectedMaximumVersion: body.expectedMaximumVersion, maximumAtCapture: submittedMaximum })).digest("hex");
  const receiptId = createHash("sha256").update(`${caller.uid}\0${schoolId}\0${operationId}`).digest("hex");
  const receiptRef = db.doc(`offlineOperationReceipts/${receiptId}`);
  const gradeId = [schoolId, schoolYearId, classId, subjectId, studentId, slot].join("__");
  const gradeRef = db.doc(`gradeEntries/${gradeId}`);
  const specificRef = db.doc(`courseGradingConfigs/${slotConfigId(schoolId, schoolYearId, classId, subjectId, slot)}`);
  const legacyRef = db.doc(`courseGradingConfigs/${[schoolId, schoolYearId, classId, subjectId].join("__")}`);
  const classRef = db.doc(`classes/${classId}`);
  const activityId = `grades_offline_${operationId}`;
  return db.runTransaction(async (transaction) => {
    const [receipt, user, profile, school, year, assigned, student, schoolClass, specific, legacy, previous] = await Promise.all([
      transaction.get(receiptRef), transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(db.doc(`teachers/${teacher.id}`)),
      transaction.get(db.doc(`schools/${schoolId}`)), transaction.get(db.doc(`schoolYears/${schoolYearId}`)),
      transaction.get(db.doc(`pedagogicalAssignments/${assignment.id}`)), transaction.get(db.doc(`students/${studentId}`)),
      transaction.get(classRef), transaction.get(specificRef), transaction.get(legacyRef), transaction.get(gradeRef),
    ]);
    if (receipt.exists) {
      if (receipt.data()?.fingerprint !== fingerprint || receipt.data()?.actorId !== caller.uid) {
        throw new GradingApiError(409, "offline-conflict", "Identifiant local déjà utilisé avec une autre saisie.");
      }
      return { ok: true, idempotent: true, gradeId: receipt.data().gradeId };
    }
    if (user.data()?.role !== "teacher" || user.data()?.schoolId !== schoolId || user.data()?.active === false
      || user.data()?.status === "inactive" || profile.data()?.userId !== caller.uid || profile.data()?.schoolId !== schoolId
      || profile.data()?.schoolYearId !== schoolYearId || profile.data()?.status === "inactive"
      || school.data()?.status !== "active" || school.data()?.activeSchoolYearId !== schoolYearId
      || year.data()?.schoolId !== schoolId || year.data()?.status !== "active"
      || assigned.data()?.teacherId !== teacher.id || assigned.data()?.schoolId !== schoolId
      || assigned.data()?.schoolYearId !== schoolYearId || assigned.data()?.classId !== classId
      || assigned.data()?.subjectId !== subjectId || assigned.data()?.active !== true) {
      throw new GradingApiError(403, "permission-denied", "Droits pédagogiques ou année scolaire modifiés depuis la saisie locale.");
    }
    const classData = schoolClass.exists ? { id: classId, ...schoolClass.data() } : undefined;
    const baseId = classBaseId(classData);
    const parentClass = baseId && baseId !== classId ? await transaction.get(db.doc(`classes/${baseId}`)) : null;
    if (!student.exists || !classData || classData.schoolId !== schoolId || classData.schoolYearId !== schoolYearId
      || student.data()?.schoolId !== schoolId || student.data()?.schoolYearId !== schoolYearId
      || !studentMatchesAssignment(student.data(), assigned.data(), classData, parentClass?.data())) {
      throw new GradingApiError(409, "offline-conflict", "L'élève ou la classe n'appartient plus à ce cours.");
    }
    const config = specific.exists ? specific : legacy;
    const maximum = Number(config.data()?.maxScore);
    if (!config.exists || !Number.isFinite(maximum) || maximum !== submittedMaximum
      || snapshotVersion(config) !== body.expectedMaximumVersion
      || snapshotVersion(previous) !== body.expectedGradeVersion) {
      throw new GradingApiError(409, "offline-conflict", "La cote ou son maximum a changé. Vérifiez la version serveur avant de résoudre ce conflit.");
    }
    if (status === "graded" && score > maximum) throw new GradingApiError(409, "offline-conflict", "La cote dépasse le maximum actuel.");
    const now = FieldValue.serverTimestamp();
    transaction.set(gradeRef, { id: gradeId, schoolId, schoolYearId, assignmentId: assignment.id,
      teacherId: previous.exists ? previous.data().teacherId : teacher.id, classId, subjectId, studentId,
      gradingSlot: slot, score, status, maxScoreSnapshot: maximum,
      createdAt: previous.exists ? previous.data().createdAt : now,
      createdBy: previous.exists ? previous.data().createdBy : caller.uid, updatedAt: now, updatedBy: caller.uid });
    transaction.create(receiptRef, { actorId: caller.uid, schoolId, schoolYearId, operationId,
      fingerprint, gradeId, createdAt: now });
    transaction.create(db.doc(`pedagogicalActivityLogs/${activityId}`), activityLog({ id: activityId,
      schoolId, schoolYearId, actorId: caller.uid, actorName: teacher.data()?.fullName,
      action: "Cote locale synchronisée", details: `Période : ${slot} · Élève : ${studentId}`,
      resourceType: "gradeEntries", resourceId: gradeId, createdAt: new Date().toISOString() }));
    return { ok: true, idempotent: false, gradeId };
  });
}

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
  const [user, profiles, year, school] = await Promise.all([
    db.doc(`users/${caller.uid}`).get(),
    db.collection("teachers").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("userId", "==", caller.uid).get(),
    db.doc(`schoolYears/${schoolYearId}`).get(),
    db.doc(`schools/${schoolId}`).get(),
  ]);
  const profile = profiles.docs[0];
  if (!user.exists || user.data()?.role !== "teacher" || user.data()?.schoolId !== schoolId || user.data()?.status === "inactive" || user.data()?.active === false || profiles.size !== 1 || profile.data().status === "inactive" || !year.exists || year.data()?.schoolId !== schoolId || !school.exists || ["suspended", "inactive", "deleting"].includes(school.data()?.status)) {
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
    titulars: serialize(titularSnapshot).filter((item) => item.active === true),
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
  return snapshots.flatMap((snapshot) => collection === "courseGradingConfigs" || collection === "gradeEntries"
    ? snapshot.docs.map((item) => ({ id: item.id, ...item.data(), documentVersion: snapshotVersion(item) }))
    : serialize(snapshot));
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
  if (previous.exists && previous.data()?.observation === observation) return { ok: true, observation: previous.data(), notificationCount: 0, notificationWarning: "" };
  const courseLabel = await courseActivityLabel(db, schoolId, schoolYearId, assignment.classId, assignment.subjectId);
  const now = new Date().toISOString();
  const payload = {
    id: observationId, schoolId, schoolYearId, teacherId: teacher.id, assignmentId: assignment.id,
    classId: assignment.classId, subjectId: assignment.subjectId, studentId, observation,
    createdAt: previous.exists ? previous.data().createdAt : now,
    createdBy: previous.exists ? previous.data().createdBy : caller.uid,
    updatedAt: now, updatedBy: caller.uid,
  };
  const observationBatch = db.batch();
  observationBatch.set(observationRef, payload);
  const activityId = `observation_${observationId}_${crypto.randomUUID()}`;
  observationBatch.set(db.doc(`pedagogicalActivityLogs/${activityId}`), activityLog({
    id: activityId, schoolId, schoolYearId, actorId: caller.uid, actorName: teacher.data()?.fullName,
    action: previous.exists ? "Observation pédagogique modifiée" : "Observation pédagogique créée",
    details: `${courseLabel} · Élève : ${[studentSnapshot.data()?.nom, studentSnapshot.data()?.postnom, studentSnapshot.data()?.prenom].filter(Boolean).join(" ") || "Élève concerné"}`,
    resourceType: "teacherStudentObservation", resourceId: observationId, createdAt: now,
  }));
  await observationBatch.commit();

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

async function loadConsolidatedClass(db, teacher, schoolId, schoolYearId, classId) {
  const { titulars } = await scope(db, teacher, schoolId, schoolYearId);
  if (!titulars.some((item) => item.classId === classId)) {
    throw new GradingApiError(403, "permission-denied", "Classe hors du titulariat autorisé.");
  }
  return loadConsolidatedSchoolClass(db, schoolId, schoolYearId, classId);
}

export async function loadConsolidatedSchoolClass(db, schoolId, schoolYearId, classId) {
  const roster = await loadCourseRoster(db, { classId, schoolId, schoolYearId }, schoolId, schoolYearId);
  const [classSnapshot, assignmentSnapshot, subjectSnapshot] = await Promise.all([
    db.collection("classes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
    db.collection("pedagogicalAssignments").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("active", "==", true).get(),
    db.collection("subjects").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get(),
  ]);
  const classes = serialize(classSnapshot);
  const byClassId = new Map(classes.map((item) => [item.id, item]));
  const assignments = serialize(assignmentSnapshot).filter((assignment) => roster.students.some((student) => {
    const assignedClass = byClassId.get(assignment.classId);
    return studentMatchesAssignment(student, assignment, assignedClass, byClassId.get(classBaseId(assignedClass)));
  }));
  const [allConfigs, allEntries] = await Promise.all([
    scopedDocuments(db, "courseGradingConfigs", schoolId, schoolYearId, assignments, []),
    scopedDocuments(db, "gradeEntries", schoolId, schoolYearId, assignments, []),
  ]);
  const studentIds = new Set(roster.students.map((student) => student.id));
  const subjectIds = new Set(assignments.map((assignment) => assignment.subjectId));
  return {
    classId,
    students: roster.students,
    classes: classes.filter((item) => item.id === classId || assignments.some((assignment) => assignment.classId === item.id) || classes.some((child) => assignments.some((assignment) => assignment.classId === child.id) && classBaseId(child) === item.id)),
    subjects: serialize(subjectSnapshot).filter((item) => subjectIds.has(item.id)),
    assignments,
    configs: allConfigs,
    entries: allEntries.filter((item) => studentIds.has(item.studentId)),
  };
}

export async function executeTeacherGrading({ db, caller, body }) {
  const action = requiredString(body.action, "Action");
  const schoolId = requiredString(body.schoolId, "École");
  const schoolYearId = requiredString(body.schoolYearId, "Année scolaire");
  const teacher = await identity(db, caller, schoolId, schoolYearId);
  if (action === "load") return loadGrading(db, teacher, schoolId, schoolYearId);
  if (action === "load-consolidated") return loadConsolidatedClass(db, teacher, schoolId, schoolYearId, requiredString(body.classId, "Classe"));

  if (["save-observation", "save-config", "save-entries", "sync-offline-grade"].includes(action)) {
    const [year, school] = await Promise.all([db.doc(`schoolYears/${schoolYearId}`).get(), db.doc(`schools/${schoolId}`).get()]);
    if (year.data()?.status !== "active" || school.data()?.activeSchoolYearId !== schoolYearId) {
      throw new GradingApiError(403, "permission-denied", "Cette année scolaire est en consultation uniquement.");
    }
  }

  const classId = requiredString(body.classId, "Classe");
  const subjectId = requiredString(body.subjectId, "Matière");
  const assignmentId = requiredString(body.assignmentId, "Affectation");
  const assignment = await assertCourse(db, teacher, schoolId, schoolYearId, classId, subjectId, assignmentId);
  if (action === "load-roster") return loadCourseRoster(db, assignment, schoolId, schoolYearId);
  if (action === "save-observation") return saveObservation(db, caller, teacher, assignment, schoolId, schoolYearId, body);
  const legacyConfigId = [schoolId, schoolYearId, classId, subjectId].join("__");
  const requestedSlot = body.gradingSlot === undefined ? null : requiredString(body.gradingSlot, "Période");
  if (requestedSlot !== null && !EDITABLE_SLOTS.has(requestedSlot)) throw new GradingApiError(400, "invalid-argument", "Période invalide.");
  const configId = requestedSlot ? slotConfigId(schoolId, schoolYearId, classId, subjectId, requestedSlot) : legacyConfigId;

  if (action === "sync-offline-grade") {
    if (!requestedSlot) throw new GradingApiError(400, "invalid-argument", "Période obligatoire.");
    return syncOfflineGrade(db, caller, teacher, assignment, schoolId, schoolYearId, classId, subjectId, requestedSlot, body);
  }

  if (action === "save-config") {
    const maxScore = Number(body.maxScore);
    if (!Number.isFinite(maxScore) || maxScore <= 0) throw new GradingApiError(400, "invalid-argument", "La cote maximale doit être supérieure à zéro.");
    const existing = await db.collection("gradeEntries").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).where("classId", "==", classId).where("subjectId", "==", subjectId).get();
    if (existing.docs.some((item) => (!requestedSlot || item.data().gradingSlot === requestedSlot) && item.data().status === "graded" && Number(item.data().score) > maxScore)) {
      throw new GradingApiError(409, "failed-precondition", `La cote maximale ne peut pas être abaissée à ${maxScore} car certaines cotes existantes dépassent cette valeur.`);
    }
    const ref = db.doc(`courseGradingConfigs/${configId}`);
    const previous = await ref.get();
    const legacy = requestedSlot && !previous.exists ? await db.doc(`courseGradingConfigs/${legacyConfigId}`).get() : null;
    const confirmation = previous.exists || legacy?.exists ? "MODIFIER LA CÔTE MAXIMALE" : "ENREGISTRER LA CÔTE MAXIMALE";
    if (body.confirmation !== confirmation) throw new GradingApiError(400, "invalid-argument", "La confirmation de la cote maximale est incorrecte.");
    if (previous.exists && Number(previous.data().maxScore) === maxScore) return { ok: true, id: configId };
    const courseLabel = await courseActivityLabel(db, schoolId, schoolYearId, classId, subjectId);
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.set(ref, { id: configId, schoolId, schoolYearId, assignmentId, teacherId: teacher.id, classId, subjectId, ...(requestedSlot ? { gradingSlot: requestedSlot } : {}), maxScore, status: "draft", createdAt: previous.exists ? previous.data().createdAt : now, createdBy: previous.exists ? previous.data().createdBy : caller.uid, updatedAt: now, updatedBy: caller.uid });
    const activityId = `maximum_${configId}_${crypto.randomUUID()}`;
    batch.set(db.doc(`pedagogicalActivityLogs/${activityId}`), activityLog({
      id: activityId, schoolId, schoolYearId, actorId: caller.uid, actorName: teacher.data()?.fullName,
      action: previous.exists ? "Cote maximale modifiée" : "Cote maximale enregistrée",
      details: `${courseLabel} · Période : ${requestedSlot ?? "Toutes"} · Maximum : ${maxScore}`,
      resourceType: "courseGradingConfig", resourceId: configId, createdAt: new Date().toISOString(),
    }));
    await batch.commit();
    return { ok: true, id: configId };
  }

  if (action === "save-entries") {
    const items = Array.isArray(body.entries) ? body.entries : [];
    // One write is reserved for the activity record in the same atomic batch.
    if (items.length > 499) throw new GradingApiError(400, "invalid-argument", "Trop de cotes.");
    const slots = [...new Set(items.map((item) => requiredString(item.gradingSlot, "Période")))];
    if (slots.some((slot) => !EDITABLE_SLOTS.has(slot) || (requestedSlot && slot !== requestedSlot))) throw new GradingApiError(400, "invalid-argument", "Période invalide.");
    const [legacyConfig, ...specificConfigs] = await Promise.all([
      db.doc(`courseGradingConfigs/${legacyConfigId}`).get(),
      ...slots.map((slot) => db.doc(`courseGradingConfigs/${slotConfigId(schoolId, schoolYearId, classId, subjectId, slot)}`).get()),
    ]);
    const maximumBySlot = new Map(slots.map((slot, index) => {
      const config = specificConfigs[index].exists ? specificConfigs[index] : legacyConfig;
      if (!config.exists || !Number.isFinite(Number(config.data().maxScore)) || Number(config.data().maxScore) <= 0) {
        throw new GradingApiError(409, "failed-precondition", "Définissez la cote maximale de ce cours avant de commencer la cotation.");
      }
      return [slot, Number(config.data().maxScore)];
    }));
    const schoolClass = await db.doc(`classes/${classId}`).get();
    const schoolClassData = schoolClass.exists ? { id: schoolClass.id ?? classId, ...schoolClass.data() } : undefined;
    const baseId = classBaseId(schoolClassData);
    const parentClass = baseId && baseId !== classId ? await db.doc(`classes/${baseId}`).get() : undefined;
    const batch = db.batch();
    const now = FieldValue.serverTimestamp();
    let changedCount = 0;
    for (const item of items) {
      const studentId = requiredString(item.studentId, "Élève");
      const slot = requiredString(item.gradingSlot, "Période");
      const status = item.status;
      if (!EDITABLE_SLOTS.has(slot) || !["graded", "not_graded", "absent"].includes(status)) throw new GradingApiError(400, "invalid-argument", "Cotation invalide.");
      const maxScore = maximumBySlot.get(slot);
      const student = await db.doc(`students/${studentId}`).get();
      if (!student.exists || student.data()?.schoolId !== schoolId || student.data()?.schoolYearId !== schoolYearId || !studentMatchesAssignment(student.data(), assignment, schoolClassData, parentClass?.data())) {
        throw new GradingApiError(403, "permission-denied", "Élève hors du périmètre autorisé.");
      }
      const score = status === "graded" && item.score !== null && item.score !== undefined && item.score !== "" ? Number(item.score) : null;
      if (status === "graded" && (score === null || !Number.isFinite(score) || score < 0 || score > maxScore)) throw new GradingApiError(400, "invalid-argument", `La cote doit être comprise entre 0 et ${maxScore}.`);
      const id = [schoolId, schoolYearId, classId, subjectId, studentId, slot].join("__");
      const ref = db.doc(`gradeEntries/${id}`);
      const previous = await ref.get();
      if (previous.exists && previous.data()?.status === status && previous.data()?.score === score && previous.data()?.maxScoreSnapshot === maxScore) continue;
      batch.set(ref, { id, schoolId, schoolYearId, assignmentId, teacherId: previous.exists ? previous.data().teacherId : teacher.id, classId, subjectId, studentId, gradingSlot: slot, score, status, maxScoreSnapshot: maxScore, createdAt: previous.exists ? previous.data().createdAt : now, createdBy: previous.exists ? previous.data().createdBy : caller.uid, updatedAt: now, updatedBy: caller.uid });
      changedCount += 1;
    }
    if (changedCount) {
      const courseLabel = await courseActivityLabel(db, schoolId, schoolYearId, classId, subjectId);
      const activityId = `grades_${crypto.randomUUID()}`;
      batch.set(db.doc(`pedagogicalActivityLogs/${activityId}`), activityLog({
        id: activityId, schoolId, schoolYearId, actorId: caller.uid, actorName: teacher.data()?.fullName,
        action: "Cotes enregistrées ou corrigées",
        details: `${courseLabel} · Périodes : ${slots.join(", ")} · Cotes modifiées : ${changedCount}`,
        resourceType: "gradeEntries", resourceId: assignmentId, createdAt: new Date().toISOString(),
      }));
    }
    if (changedCount) await batch.commit();
    return { ok: true, count: items.length };
  }
  throw new GradingApiError(400, "invalid-argument", "Action non prise en charge.");
}
