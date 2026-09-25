import { doc, writeBatch } from "firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { AppUser, AuditLog, FeeType } from "../types";

export function canDeleteFeeType(user: AppUser, fee: FeeType) {
  return user.role === "school_admin" && user.status !== "inactive" && user.schoolId === fee.schoolId;
}

export async function deleteFeeType(user: AppUser, fee: FeeType, auditLog: AuditLog, database: Firestore | undefined = db as Firestore | undefined) {
  if (!canDeleteFeeType(user, fee)) throw new Error("Suppression de ce type de frais non autorisée.");
  if (!database) throw new Error("Connexion Firestore indisponible.");
  const batch = writeBatch(database);
  batch.delete(doc(database, "feeTypes", fee.id));
  batch.set(doc(database, "auditLogs", auditLog.id), auditLog);
  await batch.commit();
}
