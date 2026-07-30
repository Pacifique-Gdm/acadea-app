import * as firestore from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, School } from "../types";
import { canUseFirestoreData } from "./firestoreData";

const serverTimestamp = (firestore as unknown as { serverTimestamp: () => unknown }).serverTimestamp;
const updateDocument = (firestore as unknown as { updateDoc: (reference: unknown, patch: Record<string, unknown>) => Promise<void> }).updateDoc;
export const DEFAULT_SCHOOL_AI_MONTHLY_LIMIT = 25;
export const MAX_SCHOOL_AI_MONTHLY_LIMIT = 1000;

export function currentAiUsageMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function schoolAiUsageThisMonth(aiAssistant: School["aiAssistant"], currentMonth = currentAiUsageMonth()) {
  const monthlyLimit = Number.isInteger(aiAssistant?.monthlyLimit) && Number(aiAssistant?.monthlyLimit) >= 1 && Number(aiAssistant?.monthlyLimit) <= MAX_SCHOOL_AI_MONTHLY_LIMIT
    ? Number(aiAssistant?.monthlyLimit)
    : DEFAULT_SCHOOL_AI_MONTHLY_LIMIT;
  const monthlyUsage = aiAssistant?.usageMonth === currentMonth && Number.isInteger(aiAssistant?.monthlyUsage) && Number(aiAssistant?.monthlyUsage) >= 0
    ? Number(aiAssistant?.monthlyUsage)
    : 0;
  return { monthlyLimit, monthlyUsage, usageMonth: currentMonth, remaining: Math.max(0, monthlyLimit - monthlyUsage), limitReached: monthlyUsage >= monthlyLimit };
}

export function validateSchoolAiMonthlyLimit(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SCHOOL_AI_MONTHLY_LIMIT;
}

export function isSchoolAiAssistantEnabled(school: Pick<School, "aiAssistant"> | null | undefined) {
  return school?.aiAssistant?.enabled === true;
}

export async function loadSchoolAiAssistantSetting(schoolId: string) {
  if (!schoolId || !canUseFirestoreData() || !db) return null;
  const snapshot = await getDoc(doc(db, "schools", schoolId));
  return snapshot.exists() ? (snapshot.data()?.aiAssistant as School["aiAssistant"] ?? null) : null;
}

export async function saveSchoolAiAssistantSetting(user: AppUser, school: Pick<School, "id" | "aiAssistant">, patch: { enabled?: boolean; monthlyLimit?: number }): Promise<NonNullable<School["aiAssistant"]>> {
  if (user.role !== "super_admin" || user.status === "inactive") {
    throw new Error("Seul un Super Administrateur actif peut modifier l’Assistant IA.");
  }
  if (!school.id) throw new Error("Établissement introuvable.");
  if (patch.monthlyLimit !== undefined && !validateSchoolAiMonthlyLimit(patch.monthlyLimit)) throw new Error("Le quota mensuel doit être un entier compris entre 1 et 1000.");

  const current = schoolAiUsageThisMonth(school.aiAssistant);
  const localValue = { ...school.aiAssistant, enabled: patch.enabled ?? school.aiAssistant?.enabled === true, monthlyLimit: patch.monthlyLimit ?? current.monthlyLimit, updatedAt: new Date().toISOString(), updatedBy: user.id };
  if (canUseFirestoreData() && db) {
    const schoolRef = doc(db, "schools", school.id);
    const firestorePatch: Record<string, unknown> = {
      "aiAssistant.updatedAt": serverTimestamp(),
      "aiAssistant.updatedBy": user.id,
    };
    if (patch.enabled !== undefined) firestorePatch["aiAssistant.enabled"] = patch.enabled;
    if (patch.monthlyLimit !== undefined) firestorePatch["aiAssistant.monthlyLimit"] = patch.monthlyLimit;
    await updateDocument(schoolRef, firestorePatch);
    const savedSchool = await getDoc(schoolRef);
    const savedSetting = savedSchool.data()?.aiAssistant as School["aiAssistant"];
    if (savedSetting) return savedSetting;
  }
  return localValue;
}
