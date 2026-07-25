import type { CardStatus, FingerprintStatus, Student, StudentBiometric } from "../types";
import { defaultStudentBiometric } from "./studentUtils";

export const fingerprintStatusLabels: Record<FingerprintStatus, string> = {
  not_enrolled: "Non enregistrée",
  enrolled: "Enregistrée",
  disabled: "Désactivée",
};

export const cardStatusLabels: Record<CardStatus, string> = {
  not_assigned: "Non associée",
  assigned: "Associée",
  disabled: "Désactivée",
};

export function resolveStudentBiometric(student: Pick<Student, "biometric">): StudentBiometric {
  return {
    fingerprintStatus: student.biometric?.fingerprintStatus ?? defaultStudentBiometric.fingerprintStatus,
    fingerprintUpdatedAt: student.biometric?.fingerprintUpdatedAt ?? null,
    cardStatus: student.biometric?.cardStatus ?? defaultStudentBiometric.cardStatus,
    cardUid: student.biometric?.cardUid ?? null,
    cardUpdatedAt: student.biometric?.cardUpdatedAt ?? null,
  };
}

export function hasEnrolledFingerprint(student: Student) {
  return resolveStudentBiometric(student).fingerprintStatus === "enrolled";
}

export function hasAssignedCard(student: Student) {
  const biometric = resolveStudentBiometric(student);
  return biometric.cardStatus === "assigned" || Boolean(biometric.cardUid);
}

export function maskCardUid(uid: string | null) {
  if (!uid) return "—";
  if (uid.length <= 4) return "••••";
  return `${uid.slice(0, 2)}${"•".repeat(Math.min(6, uid.length - 4))}${uid.slice(-2)}`;
}

export function formatBiometricDate(value: string | null) {
  if (!value) return "Jamais";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Non renseignée" : date.toLocaleString("fr-CD");
}
