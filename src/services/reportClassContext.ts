import { collection, doc, getDoc, getDocs, query, where, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { Payment, SchoolClassRecord, Student } from "../types";
import type { ReportClassContext } from "../utils/reportPdf";

type Readers = {
  readStudent: (studentId: string) => Promise<Student | null>;
  readClasses: (schoolId: string, schoolYearId: string) => Promise<SchoolClassRecord[]>;
};

async function readStudent(studentId: string): Promise<Student | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db as unknown as Firestore, "students", studentId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as Student : null;
}

async function readClasses(schoolId: string, schoolYearId: string): Promise<SchoolClassRecord[]> {
  if (!db) return [];
  const snapshot = await getDocs(query(collection(db as unknown as Firestore, "classes"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SchoolClassRecord);
}

/** Prépare la colonne « Classe » du rapport financier : classes de l'année (sous-classes)
 * et, pour un ancien élève d'une année passée, sa fiche et les classes de cette année-là.
 * Une lecture impossible n'empêche jamais l'export : la classe reste alors « — ». */
export async function loadReportClassContext(
  input: { schoolId: string; schoolYearId: string; students: readonly Student[]; payments: readonly Payment[] },
  readers: Readers = { readStudent, readClasses },
): Promise<ReportClassContext> {
  const known = new Set(input.students.map((student) => student.id));
  const missing = [...new Set(input.payments.flatMap((payment) => [payment.studentId, payment.formerStudentId, payment.currentStudentId])
    .filter((id): id is string => Boolean(id) && !known.has(id as string)))];
  const extraStudents = (await Promise.all(missing.map((id) => readers.readStudent(id).catch(() => null))))
    .filter((student): student is Student => Boolean(student && student.schoolId === input.schoolId));
  const yearIds = [...new Set([input.schoolYearId, ...extraStudents.map((student) => student.schoolYearId)])];
  const classes = (await Promise.all(yearIds.map((yearId) => readers.readClasses(input.schoolId, yearId).catch(() => [])))).flat();
  return { classes, extraStudents };
}
