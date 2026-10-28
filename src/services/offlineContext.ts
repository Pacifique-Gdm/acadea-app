import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, School, SchoolYear } from "../types";
import { loadTeacherGrading, loadTeacherGradingRoster } from "../modules/teacher/teacherGradingService";
import { loadDisciplineYearData } from "./firestoreData";
import { readOfflineContext, saveOfflineContext, type OfflineScope } from "./offlineQueue";

export type OfflineStudent = { id: string; name: string; className: string; section?: string };
export type OfflineClass = { id: string; name: string; parentClassId?: string; section?: string; option?: string; classOptionKey?: string };
export type OfflineGradeCourse = { assignmentId: string; classId: string; subjectId: string;
  className: string; subjectName: string; students: OfflineStudent[];
  configs: Array<{ slot: string; maxScore: number; version: string }>;
  entries: Array<{ studentId: string; slot: string; status: string; score: number | null; version: string }> };
export type OfflineContext = { role: AppUser["role"]; savedAt: string; schoolId: string; schoolYearId: string;
  students: OfflineStudent[]; classes: OfflineClass[];
  fees: Array<{ id: string; name: string; amount: number; currency: "CDF" | "USD" }>;
  courses: OfflineGradeCourse[]; existingAttendanceIds: string[] };

const studentName = (row: { nom?: string; postnom?: string; prenom?: string }) =>
  [row.nom, row.postnom, row.prenom].filter(Boolean).join(" ").trim();
const asStudent = (row: { id: string; nom?: string; postnom?: string; prenom?: string; className?: string; section?: string }): OfflineStudent =>
  ({ id: row.id, name: studentName(row), className: row.className ?? "", section: row.section });

/** Only references needed for local drafts are persisted; no balances, messages or tokens. */
export async function prepareOfflineContext(user: AppUser, school: School, year: SchoolYear): Promise<void> {
  if (!db || !user.schoolId || user.schoolId !== school.id || year.schoolId !== school.id
    || year.status !== "active" || school.status !== "active") return;
  const scope: OfflineScope = { userId: user.id, schoolId: school.id, schoolYearId: year.id };
  const context: OfflineContext = { role: user.role, savedAt: new Date().toISOString(), schoolId: school.id,
    schoolYearId: year.id, students: [], classes: [], fees: [], courses: [], existingAttendanceIds: [] };
  if (user.role === "teacher") {
    const grading = await loadTeacherGrading(school.id, year.id);
    if (grading.teacher.userId !== user.id) return;
    const activeAssignments = grading.assignments.filter((row) => row.active !== false);
    if (activeAssignments.length > 100) return;
    for (const assignment of activeAssignments) {
      const roster = await loadTeacherGradingRoster({ schoolId: school.id, schoolYearId: year.id,
        assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId });
      const configs = grading.configs.filter((row) => row.classId === assignment.classId && row.subjectId === assignment.subjectId)
        .filter((row) => typeof (row as { documentVersion?: unknown }).documentVersion === "string")
        .map((row) => ({ slot: row.gradingSlot ?? "legacy", maxScore: row.maxScore,
          version: (row as unknown as { documentVersion: string }).documentVersion }));
      context.courses.push({ assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId,
        className: grading.classes.find((row) => row.id === assignment.classId)?.name ?? "Classe",
        subjectName: grading.subjects.find((row) => row.id === assignment.subjectId)?.name ?? "Cours",
        students: roster.students.map(asStudent), configs,
        entries: grading.entries.filter((row) => row.classId === assignment.classId && row.subjectId === assignment.subjectId)
          .filter((row) => typeof (row as { documentVersion?: unknown }).documentVersion === "string")
          .map((row) => ({ studentId: row.studentId, slot: row.gradingSlot, status: row.status,
            score: row.score, version: (row as unknown as { documentVersion: string }).documentVersion })) });
    }
  } else if (user.role === "discipline_director") {
    const loaded = await loadDisciplineYearData(user, year.id);
    if (!loaded) return;
    context.students = loaded.students.filter((row) => row.schoolId === school.id && row.schoolYearId === year.id).map(asStudent);
    context.existingAttendanceIds = loaded.attendance.map((row) => row.id);
  } else if (["school_admin", "secretary", "cashier"].includes(user.role)) {
    const students = await getDocs(query(collection(db, "students"), where("schoolId", "==", school.id), where("schoolYearId", "==", year.id)));
    if (students.size > 2000) return;
    context.students = students.docs.map((snapshot) => asStudent({ id: snapshot.id, ...snapshot.data() }));
    if (user.role === "cashier") {
      const fees = await getDocs(query(collection(db, "feeTypes"), where("schoolId", "==", school.id), where("schoolYearId", "==", year.id)));
      const currency = year.currency === "CDF" || year.currency === "USD" ? year.currency : null;
      if (!currency) return;
      context.fees = fees.docs.map((snapshot) => ({ id: snapshot.id, name: String(snapshot.data().name ?? "Frais"),
        amount: Number(snapshot.data().amount), currency }));
    } else {
      const classes = await getDocs(query(collection(db, "classes"), where("schoolId", "==", school.id), where("schoolYearId", "==", year.id)));
      context.classes = classes.docs.filter((snapshot) => snapshot.data().active !== false)
        .map((snapshot) => ({ id: snapshot.id, name: String(snapshot.data().name ?? ""),
          parentClassId: typeof snapshot.data().parentClassId === "string" ? snapshot.data().parentClassId as string : undefined,
          section: typeof snapshot.data().section === "string" ? snapshot.data().section as string : undefined,
          option: typeof snapshot.data().option === "string" ? snapshot.data().option as string : undefined,
          classOptionKey: typeof snapshot.data().classOptionKey === "string" ? snapshot.data().classOptionKey as string : undefined }));
    }
  } else return;
  await saveOfflineContext(scope, context);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("acadea:offline-context-ready"));
}

export async function loadOfflineContext(scope: OfflineScope): Promise<OfflineContext | null> {
  const context = await readOfflineContext<OfflineContext>(scope);
  return context?.schoolId === scope.schoolId && context.schoolYearId === scope.schoolYearId ? context : null;
}
