import { collection, doc, getDocs, query, runTransaction, setDoc, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db, firebaseReady } from "../firebase";
import type { AuditLog, DisciplineSanction } from "../types";

type CreateDisciplineSanctionInput = {
  sanction: Omit<DisciplineSanction, "recurrenceNumber">;
  auditLog: AuditLog;
};

type CompleteDisciplineSanctionInput = {
  sanction: DisciplineSanction;
  completedAt: string;
  completedBy: string;
  completedByName: string;
  auditLog: AuditLog;
};

function requireFirestore() {
  if (!firebaseReady || !db) {
    throw new Error("Firestore indisponible pour la discipline.");
  }
  return db as unknown as Firestore;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function hasText(value: string) {
  return value.trim().length > 0;
}

function validateNewSanction(sanction: Omit<DisciplineSanction, "recurrenceNumber">) {
  if (
    !hasText(sanction.schoolId) ||
    !hasText(sanction.schoolYearId) ||
    !hasText(sanction.studentId) ||
    !hasText(sanction.studentName) ||
    !hasText(sanction.className) ||
    !hasText(sanction.reason) ||
    !hasText(sanction.sanctionType) ||
    !Number.isFinite(sanction.duration) ||
    sanction.duration <= 0 ||
    !hasText(sanction.startDate) ||
    !hasText(sanction.expectedEndDate) ||
    !hasText(sanction.createdBy) ||
    !hasText(sanction.createdAt) ||
    sanction.status !== "active"
  ) {
    throw new Error("Sanction disciplinaire invalide.");
  }
}

export async function createDisciplineSanction({ sanction, auditLog }: CreateDisciplineSanctionInput) {
  validateNewSanction(sanction);
  const database = requireFirestore();
  const sanctionRef = doc(database, "disciplineSanctions", sanction.id);
  const auditRef = doc(database, "auditLogs", auditLog.id);
  const existingQuery = query(
    collection(database, "disciplineSanctions"),
    where("schoolId", "==", sanction.schoolId),
    where("schoolYearId", "==", sanction.schoolYearId),
    where("studentId", "==", sanction.studentId),
  );

  let createdSanction: DisciplineSanction | null = null;
  const existingSnapshot = await getDocs(existingQuery);
  await runTransaction(database, async (transaction) => {
    createdSanction = {
      ...sanction,
      recurrenceNumber: existingSnapshot.size,
    };
    transaction.set(sanctionRef, removeUndefined(createdSanction as unknown as Record<string, unknown>));
    transaction.set(auditRef, auditLog);
  });

  if (!createdSanction) {
    throw new Error("Création de sanction incomplète.");
  }
  return createdSanction;
}

export async function completeDisciplineSanction({ sanction, completedAt, completedBy, completedByName, auditLog }: CompleteDisciplineSanctionInput) {
  if (sanction.status !== "active") {
    throw new Error("Cette sanction est déjà clôturée.");
  }
  const database = requireFirestore();
  const sanctionRef = doc(database, "disciplineSanctions", sanction.id);
  const auditRef = doc(database, "auditLogs", auditLog.id);
  const completedSanction: DisciplineSanction = {
    ...sanction,
    status: "completed",
    actualEndDate: completedAt.slice(0, 10),
    completedAt,
    completedBy,
    completedByName,
  };

  await runTransaction(database, async (transaction) => {
    const currentSnapshot = await transaction.get(sanctionRef);
    if (currentSnapshot.exists() && currentSnapshot.data().status !== "active") {
      throw new Error("Cette sanction est déjà clôturée.");
    }
    transaction.set(sanctionRef, removeUndefined(completedSanction as unknown as Record<string, unknown>));
    transaction.set(auditRef, auditLog);
  });

  return completedSanction;
}

export async function saveDisciplineAuditLog(auditLog: AuditLog) {
  const database = requireFirestore();
  await setDoc(doc(database, "auditLogs", auditLog.id), auditLog);
}

export async function countStudentDisciplineSanctions(schoolId: string, schoolYearId: string, studentId: string) {
  const database = requireFirestore();
  const snapshot = await getDocs(query(
    collection(database, "disciplineSanctions"),
    where("schoolId", "==", schoolId),
    where("schoolYearId", "==", schoolYearId),
    where("studentId", "==", studentId),
  ));
  return snapshot.size;
}
