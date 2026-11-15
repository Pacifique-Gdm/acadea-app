import { createHash } from "node:crypto";
import { buildServerAudit, AUDIT_EVENT_TYPES } from "./serverAudit.js";
import {
  ANNUAL_EXIT_KINDS,
  annualExitReason,
  annualStudentTransition,
  canonicalAnnualClassName,
  getClassSection,
  isEligibleForAnnualTransition,
  isImmediatelyPreviousArchivedYear,
  normalizeAnnualClassName,
  studentImportKey,
} from "../../src/utils/studentYearTransition.js";

/** Rattrapage du lot 20 : élèves restés « actifs » dans une année archivée alors
 * qu'ils n'ont pas été repris dans l'année suivante. Simulation par défaut ;
 * l'application archive avec le même mécanisme que le passage d'année
 * (statut TRANSFERRED, deletedAt, motif, repère annualExit) et n'efface rien. */
export const BACKFILL_JOB_ID = "backfill-lot20";
const RESTORE_FIELDS = ["status", "deletedAt", "exitReason", "exitReasonDetails", "searchArchived"];
const docs = (snapshot) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
const yearStart = (year) => Number(String(year?.name ?? "").match(/(\d{4})/)?.[1] ?? String(year?.startsAt ?? "").slice(0, 4)) || undefined;
const nextYearName = (year) => { const start = yearStart(year); return start ? `${start + 1}-${start + 2}` : "suivante"; };
const summary = (student) => ({ id: student.id, matricule: student.matricule ?? "", name: [student.nom, student.postnom, student.prenom].filter(Boolean).join(" "), className: student.className ?? "" });

function configuredSections(school, classes) {
  const normalized = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const values = [...(school.educationLevels ?? []), school.schoolType ?? ""].map(normalized);
  const sections = new Set(classes.map((item) => getClassSection(canonicalAnnualClassName(item.name) ?? item.name)));
  if (values.some((item) => item.includes("maternelle") || item === "mixte")) sections.add("Maternelle");
  if (values.some((item) => item.includes("primaire") || ["cteb", "cetb", "secondaire", "mixte"].includes(item))) sections.add("Primaire");
  if (values.some((item) => item.includes("cteb") || item.includes("cetb") || ["secondaire", "mixte"].includes(item))) sections.add("CTEB");
  if (values.some((item) => item.includes("secondaire") || item === "mixte")) sections.add("Secondaire");
  return sections;
}

/** Motif selon le cas, sinon « Non réinscrit à la rentrée AAAA-AAAA ». */
export function backfillReason(student, successor, successorClasses, sourceClasses, school, nextName) {
  const transition = annualStudentTransition(student, true);
  if (transition.result === "TERMINAL_EXIT") return { kind: ANNUAL_EXIT_KINDS.FINALIST, ...annualExitReason(ANNUAL_EXIT_KINDS.FINALIST) };
  if (successor && transition.result === "PROMOTED") {
    const exists = successorClasses.some((item) => item.active !== false && !item.parentClassId && normalizeAnnualClassName(item.name) === normalizeAnnualClassName(transition.className));
    if (!exists) {
      const section = getClassSection(transition.className);
      const kind = configuredSections(school, sourceClasses).has(section) ? ANNUAL_EXIT_KINDS.MISSING_CLASS : ANNUAL_EXIT_KINDS.MISSING_CYCLE;
      return { kind, ...annualExitReason(kind, section) };
    }
  }
  return { kind: "not-reenrolled", exitReason: "Autre", exitReasonDetails: `Non réinscrit à la rentrée ${nextName}` };
}

export async function planAnnualExitBackfill({ db, schoolId, apply = false, includeWithoutImport = false, actor = "annual-exit-backfill", now = new Date().toISOString() }) {
  if (typeof schoolId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(schoolId)) throw new Error("Identifiant d'école invalide.");
  const schoolSnap = await db.doc(`schools/${schoolId}`).get();
  if (!schoolSnap.exists) throw new Error("École introuvable.");
  const school = schoolSnap.data();
  const [yearsSnap, studentsSnap, classesSnap, jobsSnap] = await Promise.all([
    db.collection("schoolYears").where("schoolId", "==", schoolId).get(),
    db.collection("students").where("schoolId", "==", schoolId).get(),
    db.collection("classes").where("schoolId", "==", schoolId).get(),
    db.collection("archivedStudentImports").where("schoolId", "==", schoolId).get(),
  ]);
  const years = docs(yearsSnap), students = docs(studentsSnap), classes = docs(classesSnap), jobs = docs(jobsSnap);
  const activeYear = years.find((item) => item.id === school.activeSchoolYearId);
  const importedFrom = new Set(students.map((item) => item.importedFromStudentId).filter(Boolean));
  const groups = [];
  for (const year of years.filter((item) => item.status === "archived").sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    const candidates = students.filter((item) => item.schoolYearId === year.id && isEligibleForAnnualTransition(item));
    if (!candidates.length) continue;
    const successor = years.find((item) => item.studentsImportedFromYearId === year.id);
    const successorJob = successor ? jobs.find((item) => item.schoolYearId === successor.id) : undefined;
    let category;
    if (successor && successorJob && successorJob.status !== "complete") category = "import-in-progress";
    else if (successor && (successor.studentsImportedFromArchivedYear === true || successorJob?.status === "complete")) category = "after-import";
    else if (!successor && activeYear && isImmediatelyPreviousArchivedYear(year, activeYear)) category = "import-pending";
    else category = "archived-without-import";
    const successorStudents = successor ? students.filter((item) => item.schoolYearId === successor.id) : [];
    const successorKeys = new Set(successorStudents.map(studentImportKey));
    const nextName = successor?.name ?? nextYearName(year);
    const rows = candidates
      .filter((student) => !importedFrom.has(student.id) && !successorKeys.has(studentImportKey(student)) && student.terminalDecision?.type !== "reenrolled")
      .map((student) => ({ ...summary(student), ...backfillReason(student, successor, classes.filter((item) => item.schoolYearId === successor?.id), classes.filter((item) => item.schoolYearId === year.id), school, nextName) }));
    if (rows.length) groups.push({ schoolYearId: year.id, schoolYearName: year.name, category, successorYearId: successor?.id ?? null, successorYearName: successor?.name ?? null, students: rows });
  }
  const applicable = groups.filter((group) => group.category === "after-import" || (includeWithoutImport && group.category === "archived-without-import"));
  const plan = { schoolId, groups, toArchive: applicable.reduce((total, group) => total + group.students.length, 0), applied: false };
  if (!apply) return plan;

  let archived = 0, conflicts = 0;
  for (const group of applicable) {
    for (const row of group.students) {
      const written = await db.runTransaction(async (transaction) => {
        const reference = db.doc(`students/${row.id}`);
        const snapshot = await transaction.get(reference);
        const current = snapshot.exists ? snapshot.data() : undefined;
        // Fiche modifiée depuis la simulation (réactivée, archivée, reprise) : on n'y touche pas.
        if (!current || current.schoolId !== schoolId || current.schoolYearId !== group.schoolYearId || !isEligibleForAnnualTransition(current) || current.annualExit) return false;
        transaction.update(reference, {
          status: "TRANSFERRED", deletedAt: now, exitReason: row.exitReason, exitReasonDetails: row.exitReasonDetails, searchArchived: true,
          annualExit: {
            jobId: BACKFILL_JOB_ID, kind: row.kind, backfill: true, sourceSchoolYearId: group.schoolYearId, targetSchoolYearId: group.successorYearId ?? null,
            decidedBy: actor, decidedAt: now, previous: Object.fromEntries(RESTORE_FIELDS.map((key) => [key, current[key] ?? null])),
          },
        });
        return true;
      });
      if (written) archived += 1; else conflicts += 1;
    }
  }
  if (archived) {
    const auditId = `annual-exit-backfill-${createHash("sha256").update(`${schoolId}/${now}`).digest("hex").slice(0, 24)}`;
    await db.doc(`auditLogs/${auditId}`).set(buildServerAudit({
      id: auditId, eventType: AUDIT_EVENT_TYPES.STUDENTS_IMPORTED, actor: { uid: actor, role: "system" }, schoolId, schoolYearId: school.activeSchoolYearId ?? "",
      resourceType: "school", resourceId: schoolId, metadata: { kind: "annual-exit-backfill", archived, conflicts, includeWithoutImport },
    }));
  }
  return { ...plan, applied: true, archived, conflicts };
}
