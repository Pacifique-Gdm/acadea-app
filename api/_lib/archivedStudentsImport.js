import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { buildServerAudit, AUDIT_EVENT_TYPES } from "./serverAudit.js";
import {
  ANNUAL_TRANSITION_RESULTS,
  annualStudentTransition,
  canonicalAnnualClassName,
  getClassSection,
  isEligibleForAnnualTransition,
  normalizeAnnualClassName,
  studentForPersistence,
  studentImportKey,
} from "../../src/utils/studentYearTransition.js";

export const ARCHIVED_IMPORT_CHUNK_SIZE = 80;
export const TERMINAL_REENROLLMENT_CONFIRMATION = "REINSCRIRE CET ELEVE";

const ANNUAL_COLLECTIONS = [
  "classes", "students", "studentMedicalRecords", "feeTypes", "teachers", "subjects", "rooms", "schedulePeriods",
  "teacherAvailabilities", "attendanceSettings", "pedagogicalAssignments", "classTitulars", "timetables", "timetableEntries",
];
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (statusCode, code, message) => { throw Object.assign(new Error(message), { statusCode, code }); };
const identifier = (value) => typeof value === "string" && value.length <= 200 && value.length > 0 && !value.includes("/");
const docs = (snapshot) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
const scoped = (db, collection, schoolId, yearId) => {
  const query = db.collection(collection).where("schoolId", "==", schoolId);
  return yearId ? query.where("schoolYearId", "==", yearId) : query;
};
const normalized = (value) => typeof value === "string"
  ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase()
  : "";
const annualId = (collection, schoolId, yearId, sourceId) => `annual-${digest(`${collection}/${schoolId}/${yearId}/${sourceId}`)}`;
const withoutId = ({ id: _id, ...value }) => value;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function sourceSignature(rowsByCollection) {
  return digest(JSON.stringify(ANNUAL_COLLECTIONS.map((name) => [name, rowsByCollection[name].map((item) => [item.id, stableValue(withoutId(item))])])));
}

function assertChronology(sourceYear, targetYear) {
  const sourceEnd = Date.parse(sourceYear.endsAt ?? ""), targetStart = Date.parse(targetYear.startsAt ?? "");
  if (Number.isFinite(sourceEnd) && Number.isFinite(targetStart) && sourceEnd > targetStart) {
    fail(409, "failed-precondition", "L’année source doit précéder l’année scolaire active.");
  }
  const sourceName = String(sourceYear.name ?? "").match(/\d{4}/)?.[0];
  const targetName = String(targetYear.name ?? "").match(/\d{4}/)?.[0];
  if (!Number.isFinite(sourceEnd) && !Number.isFinite(targetStart) && sourceName && targetName && Number(sourceName) >= Number(targetName)) {
    fail(409, "failed-precondition", "L’année source doit précéder l’année scolaire active.");
  }
}

function configuredSections(school, classes) {
  const values = [...(school.educationLevels ?? []), school.schoolType ?? ""].map(normalized);
  const sections = new Set(classes.map((item) => getClassSection(canonicalAnnualClassName(item.name) ?? item.name)));
  if (values.some((item) => item.includes("maternelle") || item === "mixte")) sections.add("Maternelle");
  if (values.some((item) => item.includes("primaire") || ["cteb", "cetb", "secondaire", "mixte"].includes(item))) sections.add("Primaire");
  if (values.some((item) => item.includes("cteb") || item.includes("cetb") || ["secondaire", "mixte"].includes(item))) sections.add("CTEB");
  if (values.some((item) => item.includes("secondaire") || item === "mixte")) sections.add("Secondaire");
  return sections;
}

function classKey(item, byId) {
  const parent = item.parentClassId ? byId.get(item.parentClassId) : undefined;
  return [normalizeAnnualClassName(parent?.name ?? item.name), normalized(item.option), normalized(item.subClassLabel), normalized(item.section)].join("|");
}

function classMaps(sourceClasses, targetClasses, schoolId, yearId) {
  const sourceById = new Map(sourceClasses.map((item) => [item.id, item]));
  const targetById = new Map(targetClasses.map((item) => [item.id, item]));
  const targetByKey = new Map(targetClasses.map((item) => [classKey(item, targetById), item]));
  const ids = new Map();
  for (const source of sourceClasses) ids.set(source.id, targetByKey.get(classKey(source, sourceById))?.id ?? annualId("classes", schoolId, yearId, source.id));
  const payloads = sourceClasses.flatMap((source) => {
    const id = ids.get(source.id), existing = targetClasses.find((item) => item.id === id);
    if (existing) return [];
    const parentClassId = source.parentClassId ? ids.get(source.parentClassId) : undefined;
    let classOptionKey = source.classOptionKey;
    if (classOptionKey && source.parentClassId && parentClassId) classOptionKey = classOptionKey.replace(source.parentClassId, parentClassId);
    const payload = studentForPersistence({
      ...withoutId(source), id, schoolId, schoolYearId: yearId,
      parentClassId, classOptionKey,
      annualImportSourceId: source.id, annualImportSourceSchoolYearId: source.schoolYearId,
    });
    return [{ collection: "classes", id, payload, source }];
  });
  const planned = [...targetClasses, ...payloads.map((item) => item.payload)];
  return { ids, payloads, planned };
}

function classOption(classOptionKey) {
  return classOptionKey?.split("::").at(-1)?.trim();
}

function resolveTargetClass(className, option, classes, school, sourceClasses) {
  const targetName = normalizeAnnualClassName(className);
  const parents = classes.filter((item) => item.active !== false && !item.parentClassId && normalizeAnnualClassName(item.name) === targetName);
  if (parents.length > 1) fail(409, "failed-precondition", `Plusieurs classes cibles correspondent à ${className}.`);
  if (!parents.length) {
    const section = getClassSection(className);
    if (configuredSections(school, sourceClasses).has(section)) {
      fail(409, "failed-precondition", `La classe structurée ${className} manque alors que ce cycle est configuré dans l’école.`);
    }
    return undefined;
  }
  const parent = parents[0];
  if (!option) return { classId: parent.id };
  const optionMatches = classes.filter((item) => item.active !== false && item.parentClassId === parent.id
    && normalized(item.option ?? classOption(item.classOptionKey)) === normalized(option));
  const optionKeys = [...new Set(optionMatches.map((item) => item.classOptionKey).filter(Boolean))];
  if (optionKeys.length > 1) fail(409, "failed-precondition", `Plusieurs options cibles correspondent à ${className} ${option}.`);
  const configuredOptions = Array.isArray(school.schoolOptions) ? school.schoolOptions.map(normalized).filter(Boolean) : [];
  if (!optionMatches.length && configuredOptions.length && !configuredOptions.includes(normalized(option))) {
    fail(409, "failed-precondition", `L’option ${option} n’existe plus dans la configuration de l’école.`);
  }
  return { classId: parent.id, ...(optionKeys[0] ? { classOptionKey: optionKeys[0] } : {}) };
}

function studentIdentityDocument(source, schoolId, yearId, transition, targetClass) {
  const permanent = {};
  for (const key of ["matricule", "nom", "postnom", "prenom", "sexe", "birthDate", "address", "phone", "photoUrl", "parentId", "biometric"]) {
    if (source[key] !== undefined) permanent[key] = source[key];
  }
  return studentForPersistence({
    ...permanent,
    id: annualId("students", schoolId, yearId, source.id), schoolId, schoolYearId: yearId, annee_scolaire_id: yearId,
    className: transition.className, section: getClassSection(transition.className), option: transition.option,
    ...targetClass, status: "ACTIVE", importedFromStudentId: source.id, importedFromSchoolYearId: source.schoolYearId,
  });
}

export function importedStudentDocument(source, schoolId, yearId, classes, school = {}) {
  const initial = annualStudentTransition(source, true);
  if (initial.result !== ANNUAL_TRANSITION_RESULTS.PROMOTED) return undefined;
  const scopedClasses = classes.filter((item) => item.schoolId === schoolId && item.schoolYearId === yearId);
  const targetClass = resolveTargetClass(initial.className, initial.option, scopedClasses, school, scopedClasses);
  return studentIdentityDocument(source, schoolId, yearId, initial, targetClass ?? {});
}

function uniqueStudents(sources) {
  const unique = new Map();
  for (const source of sources) {
    const key = studentImportKey(source);
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

function semanticTargetMap(sourceRows, targetRows, key, collection, schoolId, yearId) {
  const targetBySource = new Map(targetRows.filter((item) => item.annualImportSourceId).map((item) => [item.annualImportSourceId, item]));
  const targetByKey = new Map(targetRows.map((item) => [key(item), item]));
  return new Map(sourceRows.map((source) => [source.id, targetBySource.get(source.id)?.id ?? targetByKey.get(key(source))?.id ?? annualId(collection, schoolId, yearId, source.id)]));
}

function remapOptionKey(value, classIds) {
  if (typeof value !== "string") return value;
  for (const [source, target] of classIds) if (value.startsWith(`${source}::`)) return `${target}${value.slice(source.length)}`;
  return value;
}

function genericPayload(_collection, source, id, schoolId, yearId, changes = {}) {
  void _collection;
  return studentForPersistence({
    ...withoutId(source), ...changes, id, schoolId, schoolYearId: yearId,
    annualImportSourceId: source.id, annualImportSourceSchoolYearId: source.schoolYearId,
  });
}

function planAnnualImport({ school, schoolId, schoolYearId, source, target, parents, parentUsers }) {
  const classPlan = classMaps(source.classes, target.classes, schoolId, schoolYearId);
  const targetClasses = classPlan.planned;
  const students = uniqueStudents(source.students);
  const transitions = [], studentIds = new Map(), studentWrites = [], studentLinkWrites = [];
  for (const student of students) {
    if (!student.nom || !student.prenom || !student.className || studentImportKey(student) === "|||") fail(409, "failed-precondition", "Une fiche source ne possède pas l’identité ou la classe nécessaire à l’import.");
    const preliminary = annualStudentTransition(student, true);
    if (preliminary.result === "INVALID_CLASS") fail(409, "failed-precondition", `Classe source non reconnue pour ${student.matricule || student.id}.`);
    if (preliminary.result !== ANNUAL_TRANSITION_RESULTS.PROMOTED) { transitions.push({ student, transition: preliminary }); continue; }
    const resolved = resolveTargetClass(preliminary.className, preliminary.option, targetClasses, school, source.classes);
    const transition = resolved ? preliminary : annualStudentTransition(student, false);
    transitions.push({ student, transition });
    if (transition.result !== ANNUAL_TRANSITION_RESULTS.PROMOTED) continue;
    const matchingTargets = target.students.filter((item) => studentImportKey(item) === studentImportKey(student));
    if (matchingTargets.length > 1) fail(409, "failed-precondition", "Des doublons existent déjà dans l’année cible. Aucun élève n’a été écrasé.");
    const existing = matchingTargets[0];
    const proposed = studentIdentityDocument(student, schoolId, schoolYearId, transition, resolved);
    if (existing && student.parentId && existing.parentId !== student.parentId) fail(409, "failed-precondition", "Un lien parent existant diffère de l’archive. Vérification requise sans écrasement.");
    const targetStudent = existing ?? proposed;
    studentIds.set(student.id, targetStudent.id);
    if (!existing) studentWrites.push({ collection: "students", id: proposed.id, payload: proposed, source: student, kind: "student" });
    else if (student.parentId) {
      const parent = parents.get(student.parentId);
      if (!parent) fail(409, "failed-precondition", "Un parent source est absent ou appartient à une autre école.");
      const linkedUsers = parentUsers.filter((entry) => entry.parentId === parent.id);
      const parentUser = parent.userId ? parentUsers.find((entry) => entry.id === parent.userId) : linkedUsers[0];
      if (linkedUsers.length > 1 || (parent.userId && (!parentUser || parentUser.parentId !== parent.id))) fail(409, "failed-precondition", "Le compte du parent source est incohérent.");
      if (!(parent.studentIds ?? []).includes(targetStudent.id) || (parentUser && !(parentUser.studentIds ?? []).includes(targetStudent.id))) {
        studentLinkWrites.push({ collection: "studentLinks", id: `${student.id}:${targetStudent.id}`, source: student, targetStudentId: targetStudent.id, kind: "student-link" });
      }
    }
  }

  const teacherIds = semanticTargetMap(source.teachers, target.teachers, (item) => normalized(item.userId || item.email || item.fullName), "teachers", schoolId, schoolYearId);
  const subjectIds = semanticTargetMap(source.subjects, target.subjects, (item) => `${normalized(item.name)}|${normalized(item.section)}`, "subjects", schoolId, schoolYearId);
  const roomIds = semanticTargetMap(source.rooms, target.rooms, (item) => normalized(item.name), "rooms", schoolId, schoolYearId);
  const periodIds = semanticTargetMap(source.schedulePeriods, target.schedulePeriods, (item) => [normalized(item.label), item.startTime, item.endTime, item.type, item.dayScope].join("|"), "schedulePeriods", schoolId, schoolYearId);
  const timetableIds = semanticTargetMap(source.timetables, target.timetables, (item) => `${item.version}|${item.status}`, "timetables", schoolId, schoolYearId);

  const assignmentKey = (item, mapped = false) => [
    mapped ? item.teacherId : teacherIds.get(item.teacherId), mapped ? item.subjectId : subjectIds.get(item.subjectId), mapped ? item.classId : classPlan.ids.get(item.classId), item.active !== false,
  ].join("|");
  const assignmentIds = semanticTargetMap(source.pedagogicalAssignments, target.pedagogicalAssignments, (item) => assignmentKey(item, item.schoolYearId === schoolYearId), "pedagogicalAssignments", schoolId, schoolYearId);

  if (source.subjects.some((item) => item.classIds?.some((classId) => !classPlan.ids.has(classId)))) fail(409, "failed-precondition", "Un cours source référence une classe annuelle absente.");
  if (source.teacherAvailabilities.some((item) => !teacherIds.has(item.teacherId))) fail(409, "failed-precondition", "Une disponibilité source référence un enseignant absent.");
  if (source.pedagogicalAssignments.some((item) => !teacherIds.has(item.teacherId) || !subjectIds.has(item.subjectId) || !classPlan.ids.has(item.classId) || (item.preferredRoomId && !roomIds.has(item.preferredRoomId)))) {
    fail(409, "failed-precondition", "Une affectation pédagogique source possède une référence annuelle incohérente.");
  }
  if (source.classTitulars.some((item) => !classPlan.ids.has(item.classId) || !teacherIds.has(item.teacherId) || (item.assignmentId && !assignmentIds.has(item.assignmentId)))) {
    fail(409, "failed-precondition", "Une titularité source possède une référence annuelle incohérente.");
  }
  if (source.timetableEntries.some((item) => !timetableIds.has(item.scheduleId) || !assignmentIds.has(item.assignmentId) || !teacherIds.has(item.teacherId)
    || !subjectIds.has(item.subjectId) || !classPlan.ids.has(item.classId) || !periodIds.has(item.periodId) || (item.roomId && !roomIds.has(item.roomId)))) {
    fail(409, "failed-precondition", "Un horaire source possède une référence annuelle incohérente.");
  }

  const plans = [{ name: "classes", writes: classPlan.payloads }, { name: "students", writes: studentWrites }, { name: "studentLinks", writes: studentLinkWrites }];
  const addPlan = (name, sourceRows, targetRows, ids, transform) => {
    const targetIds = new Set(targetRows.map((item) => item.id));
    plans.push({ name, writes: sourceRows.flatMap((item) => {
      const id = ids.get(item.id);
      return targetIds.has(id) ? [] : [{ collection: name, id, payload: transform(item, id), source: item }];
    }) });
  };

  const medicalIds = new Map(source.studentMedicalRecords.flatMap((item) => studentIds.has(item.studentId ?? item.id) ? [[item.id, studentIds.get(item.studentId ?? item.id)]] : []));
  addPlan("studentMedicalRecords", source.studentMedicalRecords.filter((item) => medicalIds.has(item.id)), target.studentMedicalRecords, medicalIds,
    (item, id) => genericPayload("studentMedicalRecords", item, id, schoolId, schoolYearId, { studentId: id }));

  const feeIds = semanticTargetMap(source.feeTypes, target.feeTypes, (item) => [normalized(item.name), Number(item.amount), normalizeAnnualClassName(item.className), normalized(remapOptionKey(item.classOptionKey, classPlan.ids))].join("|"), "feeTypes", schoolId, schoolYearId);
  addPlan("feeTypes", source.feeTypes, target.feeTypes, feeIds, (item, id) => genericPayload("feeTypes", item, id, schoolId, schoolYearId, { classOptionKey: remapOptionKey(item.classOptionKey, classPlan.ids) }));
  addPlan("teachers", source.teachers, target.teachers, teacherIds, (item, id) => genericPayload("teachers", item, id, schoolId, schoolYearId));
  addPlan("subjects", source.subjects, target.subjects, subjectIds, (item, id) => genericPayload("subjects", item, id, schoolId, schoolYearId, { classIds: item.classIds?.map((classId) => classPlan.ids.get(classId)).filter(Boolean) }));
  addPlan("rooms", source.rooms, target.rooms, roomIds, (item, id) => genericPayload("rooms", item, id, schoolId, schoolYearId));
  addPlan("schedulePeriods", source.schedulePeriods, target.schedulePeriods, periodIds, (item, id) => genericPayload("schedulePeriods", item, id, schoolId, schoolYearId));

  const availabilityIds = semanticTargetMap(source.teacherAvailabilities, target.teacherAvailabilities, (item) => [teacherIds.get(item.teacherId) ?? item.teacherId, item.dayOfWeek, item.status, item.startTime, item.endTime, item.active !== false].join("|"), "teacherAvailabilities", schoolId, schoolYearId);
  addPlan("teacherAvailabilities", source.teacherAvailabilities.filter((item) => teacherIds.has(item.teacherId)), target.teacherAvailabilities, availabilityIds,
    (item, id) => genericPayload("teacherAvailabilities", item, id, schoolId, schoolYearId, { teacherId: teacherIds.get(item.teacherId) }));

  const attendanceIds = semanticTargetMap(source.attendanceSettings, target.attendanceSettings, () => "settings", "attendanceSettings", schoolId, schoolYearId);
  addPlan("attendanceSettings", source.attendanceSettings, target.attendanceSettings, attendanceIds, (item, id) => {
    const remapRecord = (record) => record && Object.fromEntries(Object.entries(record).flatMap(([classId, value]) => classPlan.ids.has(classId) ? [[classPlan.ids.get(classId), value]] : []));
    return genericPayload("attendanceSettings", item, id, schoolId, schoolYearId, { classSchedule: remapRecord(item.classSchedule), classLateAfter: remapRecord(item.classLateAfter) });
  });

  const validAssignments = source.pedagogicalAssignments.filter((item) => teacherIds.has(item.teacherId) && subjectIds.has(item.subjectId) && classPlan.ids.has(item.classId));
  addPlan("pedagogicalAssignments", validAssignments, target.pedagogicalAssignments, assignmentIds, (item, id) => genericPayload("pedagogicalAssignments", item, id, schoolId, schoolYearId, {
    teacherId: teacherIds.get(item.teacherId), subjectId: subjectIds.get(item.subjectId), classId: classPlan.ids.get(item.classId),
    preferredRoomId: item.preferredRoomId ? roomIds.get(item.preferredRoomId) : item.preferredRoomId,
    titularClassId: item.titularClassId ? classPlan.ids.get(item.titularClassId) : item.titularClassId,
  }));

  const titularIds = semanticTargetMap(source.classTitulars, target.classTitulars, (item) => classPlan.ids.get(item.classId) ?? item.classId, "classTitulars", schoolId, schoolYearId);
  addPlan("classTitulars", source.classTitulars.filter((item) => classPlan.ids.has(item.classId) && teacherIds.has(item.teacherId)), target.classTitulars, titularIds,
    (item, id) => genericPayload("classTitulars", item, id, schoolId, schoolYearId, { classId: classPlan.ids.get(item.classId), teacherId: teacherIds.get(item.teacherId), assignmentId: assignmentIds.get(item.assignmentId) }));

  addPlan("timetables", source.timetables, target.timetables, timetableIds, (item, id) => genericPayload("timetables", item, id, schoolId, schoolYearId));
  const entryIds = semanticTargetMap(source.timetableEntries, target.timetableEntries, (item) => [timetableIds.get(item.scheduleId) ?? item.scheduleId, assignmentIds.get(item.assignmentId) ?? item.assignmentId, item.dayOfWeek, periodIds.get(item.periodId) ?? item.periodId].join("|"), "timetableEntries", schoolId, schoolYearId);
  const validEntries = source.timetableEntries.filter((item) => timetableIds.has(item.scheduleId) && assignmentIds.has(item.assignmentId) && teacherIds.has(item.teacherId) && subjectIds.has(item.subjectId) && classPlan.ids.has(item.classId) && periodIds.has(item.periodId));
  addPlan("timetableEntries", validEntries, target.timetableEntries, entryIds, (item, id) => genericPayload("timetableEntries", item, id, schoolId, schoolYearId, {
    scheduleId: timetableIds.get(item.scheduleId), assignmentId: assignmentIds.get(item.assignmentId), teacherId: teacherIds.get(item.teacherId), subjectId: subjectIds.get(item.subjectId), classId: classPlan.ids.get(item.classId), periodId: periodIds.get(item.periodId), roomId: item.roomId ? roomIds.get(item.roomId) ?? null : null,
  }));

  const counts = {
    promotedCount: transitions.filter((item) => item.transition.result === ANNUAL_TRANSITION_RESULTS.PROMOTED).length,
    terminalExitCount: transitions.filter((item) => item.transition.result === ANNUAL_TRANSITION_RESULTS.TERMINAL_EXIT).length,
    schoolCycleExitCount: transitions.filter((item) => item.transition.result === ANNUAL_TRANSITION_RESULTS.SCHOOL_CYCLE_EXIT).length,
    skippedCount: transitions.filter((item) => item.transition.result === ANNUAL_TRANSITION_RESULTS.SKIPPED_INACTIVE).length,
  };
  return { plans, transitions, studentIds, counts, targetClasses };
}

function importResult({ job, sourceCount, uniqueCount, plan, selected, sourceYearId, schoolYearId, complete }) {
  const pending = plan.plans.reduce((total, phase) => total + phase.writes.length, 0);
  const remaining = Math.max(0, pending - selected.length);
  const phase = plan.plans.find((item) => item.writes.length > selected.filter((write) => write.collection === item.name).length)?.name ?? "complete";
  const pendingStudentWrites = plan.plans.find((item) => item.name === "students").writes.length;
  const selectedStudentWrites = selected.filter((item) => item.collection === "students").length;
  const existingCount = plan.counts.promotedCount - pendingStudentWrites;
  return {
    status: complete ? "complete" : job ? "partial" : "ready", sourceCount, uniqueCount,
    importedCount: (job?.result?.importedCount ?? 0) + selectedStudentWrites, existingCount,
    remaining, complete, sourceYearId, schoolYearId, phase, ...plan.counts,
    importedCollections: Object.fromEntries(plan.plans.map((item) => [item.name, item.writes.length - Math.max(0, item.writes.length - selected.filter((write) => write.collection === item.name).length)])),
  };
}

/** One request writes at most 80 primary annual documents. Parent reverse links,
 * the server-owned job and its unique audit are committed in the same transaction. */
export async function importArchivedStudents({ db, caller, body }) {
  const { schoolId, schoolYearId, sourceYearId } = body;
  const perform = body.mode === "import";
  if (![schoolId, schoolYearId, sourceYearId].every(identifier) || schoolYearId === sourceYearId) fail(400, "invalid-argument", "École et années source/cible distinctes requises.");
  if (caller.role !== "secretary" || caller.schoolId !== schoolId) fail(403, "permission-denied", "Import réservé au Secrétaire de cette école.");
  if (perform && body.confirmation !== "IMPORTER LES ELEVES") fail(400, "invalid-argument", "Veuillez saisir exactement IMPORTER LES ELEVES.");
  const jobId = digest(`${schoolId}/${schoolYearId}`), jobRef = db.doc(`archivedStudentImports/${jobId}`), yearRef = db.doc(`schoolYears/${schoolYearId}`);

  return db.runTransaction(async (transaction) => {
    const contextReads = await Promise.all([
      transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(db.doc(`schools/${schoolId}`)), transaction.get(db.doc(`schoolYears/${sourceYearId}`)), transaction.get(yearRef), transaction.get(jobRef),
    ]);
    const [userSnap, schoolSnap, sourceSnap, yearSnap, jobSnap] = contextReads;
    const user = userSnap.data(), school = schoolSnap.data(), sourceYear = sourceSnap.data(), year = yearSnap.data(), job = jobSnap.data();
    if (!userSnap.exists || user.role !== "secretary" || user.schoolId !== schoolId || user.status !== "active" || user.active === false || user.archivedAt) fail(403, "permission-denied", "Compte Secrétaire actif requis.");
    if (!schoolSnap.exists || school.status !== "active") fail(403, "permission-denied", "École inactive ou inaccessible.");
    if (!sourceSnap.exists || !yearSnap.exists || sourceYear.schoolId !== schoolId || year.schoolId !== schoolId) fail(403, "permission-denied", "Les deux années doivent appartenir à cette école.");
    if (sourceYear.status !== "archived" || year.status !== "active" || school.activeSchoolYearId !== schoolYearId) fail(409, "failed-precondition", "Import autorisé uniquement depuis une archive vers l’année active de l’école.");
    assertChronology(sourceYear, year);
    if (job && (job.schoolId !== schoolId || job.sourceYearId !== sourceYearId || job.schoolYearId !== schoolYearId)) fail(409, "failed-precondition", "Une autre année source est déjà associée à cette année cible.");
    if (!job && year.studentsImportedFromYearId && year.studentsImportedFromYearId !== sourceYearId) fail(409, "failed-precondition", "Les données de l’année source précédente ont déjà été importées vers cette année cible.");
    if (job?.status === "complete") return { ...job.result, status: "complete", complete: true, remaining: 0 };

    const snapshots = await Promise.all(ANNUAL_COLLECTIONS.flatMap((name) => [
      transaction.get(scoped(db, name, schoolId, sourceYearId)), transaction.get(scoped(db, name, schoolId, schoolYearId)),
    ]));
    const source = {}, target = {};
    ANNUAL_COLLECTIONS.forEach((name, index) => { source[name] = docs(snapshots[index * 2]).sort((a, b) => a.id.localeCompare(b.id)); target[name] = docs(snapshots[index * 2 + 1]); });
    if (!source.students.length) {
      if (perform) fail(409, "failed-precondition", "Aucun élève dans l’année source archivée.");
      return { status: "empty", sourceCount: 0, uniqueCount: 0, remaining: 0, importedCount: 0, existingCount: 0, complete: false, sourceYearId, schoolYearId, promotedCount: 0, terminalExitCount: 0, schoolCycleExitCount: 0, skippedCount: 0 };
    }
    const signature = sourceSignature(source);
    if (job && job.signature !== signature) fail(409, "failed-precondition", "Les données source ont changé depuis le début de l’import. Une vérification administrative est nécessaire.");
    const [parentRows, parentUserRows] = await Promise.all([
      transaction.get(scoped(db, "parents", schoolId)), transaction.get(scoped(db, "users", schoolId).where("role", "==", "parent")),
    ]);
    const parents = new Map(docs(parentRows).map((item) => [item.id, item])), parentUsers = docs(parentUserRows);
    const plan = planAnnualImport({ school, schoolId, schoolYearId, source, target, parents, parentUsers });
    const selected = [];
    for (const phase of plan.plans) {
      const capacity = ARCHIVED_IMPORT_CHUNK_SIZE - selected.length;
      if (capacity <= 0) break;
      const phaseSelection = phase.writes.slice(0, capacity);
      selected.push(...phaseSelection);
      if (phase.writes.length > capacity || selected.length >= ARCHIVED_IMPORT_CHUNK_SIZE) break;
    }
    const complete = perform && plan.plans.reduce((total, phase) => total + phase.writes.length, 0) === selected.length;
    const result = importResult({ job, sourceCount: source.students.length, uniqueCount: uniqueStudents(source.students).length, plan, selected: perform ? selected : [], sourceYearId, schoolYearId, complete });
    if (!perform) return { ...result, complete: false, status: job ? "partial" : year.studentsImportedFromArchivedYear ? "legacy-incomplete" : "ready" };

    const parentLinks = new Map(), userLinks = new Map();
    for (const item of selected) {
      if (item.kind !== "student-link") transaction.create(db.doc(`${item.collection}/${item.id}`), item.payload);
      if (!['student', 'student-link'].includes(item.kind) || !item.source.parentId) continue;
      const parent = parents.get(item.source.parentId);
      if (!parent) fail(409, "failed-precondition", "Un parent source est absent ou appartient à une autre école.");
      const linkedUsers = parentUsers.filter((entry) => entry.parentId === parent.id);
      const parentUser = parent.userId ? parentUsers.find((entry) => entry.id === parent.userId) : linkedUsers[0];
      if (linkedUsers.length > 1 || (parent.userId && (!parentUser || parentUser.parentId !== parent.id))) fail(409, "failed-precondition", "Le compte du parent source est incohérent.");
      const targetStudentId = item.kind === "student-link" ? item.targetStudentId : item.id;
      parentLinks.set(parent.id, [...(parentLinks.get(parent.id) ?? []), targetStudentId]);
      if (parentUser) userLinks.set(parentUser.id, [...(userLinks.get(parentUser.id) ?? []), targetStudentId]);
    }
    for (const [id, ids] of parentLinks) transaction.update(db.doc(`parents/${id}`), { studentIds: FieldValue.arrayUnion(...ids) });
    for (const [id, ids] of userLinks) transaction.update(db.doc(`users/${id}`), { studentIds: FieldValue.arrayUnion(...ids) });
    const processedItems = (job?.processedItems ?? 0) + selected.length;
    const jobDocument = { version: 2, schoolId, sourceYearId, schoolYearId, signature, status: complete ? "complete" : "in_progress", phase: result.phase, processedItems, result: { ...result, complete, status: complete ? "complete" : "partial" }, createdBy: job?.createdBy ?? caller.uid, updatedAt: FieldValue.serverTimestamp() };
    transaction.set(jobRef, jobDocument);
    if (complete) {
      transaction.update(yearRef, { studentsImportedFromArchivedYear: true, studentsImportedFromYearId: sourceYearId, studentsImportedAt: new Date().toISOString(), annualImportStatus: "COMPLETED", annualImportJobId: jobId });
      const auditRef = db.doc(`auditLogs/archived-import-${jobId}`);
      transaction.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.STUDENTS_IMPORTED, actor: caller, schoolId, schoolYearId, resourceType: "schoolYear", resourceId: schoolYearId, metadata: { sourceYearId, ...plan.counts, importedCollections: selected.length } }));
    } else if (year.studentsImportedFromArchivedYear) transaction.update(yearRef, { studentsImportedFromArchivedYear: false, annualImportStatus: "IN_PROGRESS" });
    return { ...result, complete, status: complete ? "complete" : "partial" };
  });
}

function adminRole(role) {
  return role === "school_admin" || role === "admin";
}

export async function reenrollTerminalStudent({ db, caller, body }) {
  const { schoolId, sourceStudentId } = body;
  const perform = body.mode !== "inspect";
  if (![schoolId, sourceStudentId].every(identifier)) fail(400, "invalid-argument", "École et élève source requis.");
  if ((!adminRole(caller.role) && caller.role !== "secretary") || caller.schoolId !== schoolId) fail(403, "permission-denied", "Réinscription réservée à l’Administrateur ou au Secrétaire de cette école.");
  if (perform && body.confirmation !== TERMINAL_REENROLLMENT_CONFIRMATION) fail(400, "invalid-argument", `Veuillez saisir exactement ${TERMINAL_REENROLLMENT_CONFIRMATION}.`);
  return db.runTransaction(async (transaction) => {
    const userRef = db.doc(`users/${caller.uid}`), schoolRef = db.doc(`schools/${schoolId}`), sourceRef = db.doc(`students/${sourceStudentId}`);
    const [userSnap, schoolSnap, sourceSnap] = await Promise.all([transaction.get(userRef), transaction.get(schoolRef), transaction.get(sourceRef)]);
    const user = userSnap.data(), school = schoolSnap.data(), source = sourceSnap.data();
    if (!userSnap.exists || ((!adminRole(user.role) && user.role !== "secretary")) || user.schoolId !== schoolId || user.status !== "active" || user.active === false || user.archivedAt) fail(403, "permission-denied", "Compte Administrateur ou Secrétaire actif requis.");
    if (!schoolSnap.exists || school.status !== "active" || !identifier(school.activeSchoolYearId)) fail(409, "failed-precondition", "Aucune année scolaire active n’est disponible.");
    if (!sourceSnap.exists || source.schoolId !== schoolId) fail(403, "permission-denied", "Élève historique inaccessible.");
    if (canonicalAnnualClassName(source.className) !== "4ème Humanité") fail(409, "failed-precondition", "Seuls les élèves de 4ème Humanité peuvent être réinscrits par ce workflow.");
    if (!isEligibleForAnnualTransition(source)) fail(409, "failed-precondition", "Le statut de cet élève interdit sa réinscription.");
    const targetYearId = school.activeSchoolYearId;
    if (source.schoolYearId === targetYearId) fail(409, "failed-precondition", "La fiche source doit appartenir à une année archivée.");
    const [sourceYearSnap, targetYearSnap, classesSnap, targetsSnap, parentSnap, parentUsersSnap, medicalSnap] = await Promise.all([
      transaction.get(db.doc(`schoolYears/${source.schoolYearId}`)), transaction.get(db.doc(`schoolYears/${targetYearId}`)),
      transaction.get(scoped(db, "classes", schoolId, targetYearId)), transaction.get(scoped(db, "students", schoolId, targetYearId)),
      source.parentId ? transaction.get(db.doc(`parents/${source.parentId}`)) : Promise.resolve(undefined),
      transaction.get(scoped(db, "users", schoolId).where("role", "==", "parent")), transaction.get(db.doc(`studentMedicalRecords/${sourceStudentId}`)),
    ]);
    if (!sourceYearSnap.exists || sourceYearSnap.data().schoolId !== schoolId || sourceYearSnap.data().status !== "archived") fail(409, "failed-precondition", "La fiche source doit appartenir à une année archivée de cette école.");
    if (!targetYearSnap.exists || targetYearSnap.data().schoolId !== schoolId || targetYearSnap.data().status !== "active") fail(409, "failed-precondition", "L’année cible active est incohérente.");
    const classes = docs(classesSnap), targetClass = resolveTargetClass("4ème Humanité", source.option, classes, school, classes);
    if (!targetClass) fail(409, "failed-precondition", "La 4ème Humanité n’existe pas dans l’année active.");
    const id = annualId("students", schoolId, targetYearId, sourceStudentId), targets = docs(targetsSnap);
    const existing = targets.find((item) => item.id === id || studentImportKey(item) === studentImportKey(source));
    if (existing) return { status: "already-reenrolled", created: false, sourceStudentId, targetStudentId: existing.id, schoolYearId: targetYearId };
    if (!perform) return { status: "ready", created: false, sourceStudentId, targetStudentId: id, schoolYearId: targetYearId };
    const transition = { className: "4ème Humanité", option: source.option };
    const target = studentIdentityDocument(source, schoolId, targetYearId, transition, targetClass);
    transaction.create(db.doc(`students/${id}`), target);
    if (source.parentId) {
      if (!parentSnap?.exists || parentSnap.data().schoolId !== schoolId) fail(409, "failed-precondition", "Le parent source est absent ou incohérent.");
      transaction.update(db.doc(`parents/${source.parentId}`), { studentIds: FieldValue.arrayUnion(id) });
      const users = docs(parentUsersSnap).filter((item) => item.parentId === source.parentId);
      if (users.length > 1) fail(409, "failed-precondition", "Plusieurs comptes désignent le même parent.");
      if (users[0]) transaction.update(db.doc(`users/${users[0].id}`), { studentIds: FieldValue.arrayUnion(id) });
    }
    if (medicalSnap.exists && medicalSnap.data().schoolId === schoolId && medicalSnap.data().schoolYearId === source.schoolYearId) {
      transaction.create(db.doc(`studentMedicalRecords/${id}`), studentForPersistence({ ...medicalSnap.data(), id, studentId: id, schoolId, schoolYearId: targetYearId, annualImportSourceId: sourceStudentId, annualImportSourceSchoolYearId: source.schoolYearId }));
    }
    const auditRef = db.doc(`auditLogs/terminal-reenrollment-${digest(`${schoolId}/${targetYearId}/${sourceStudentId}`)}`);
    transaction.create(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.STUDENT_TERMINAL_REENROLLED, actor: caller, schoolId, schoolYearId: targetYearId, resourceType: "student", resourceId: id, metadata: { sourceStudentId, targetStudentId: id, sourceSchoolYearId: source.schoolYearId, targetSchoolYearId: targetYearId, className: "4ème Humanité" } }));
    return { status: "reenrolled", created: true, sourceStudentId, targetStudentId: id, schoolYearId: targetYearId };
  });
}
