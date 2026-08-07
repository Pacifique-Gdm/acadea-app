import * as firestore from "firebase/firestore";
import { doc, getDoc, runTransaction } from "firebase/firestore";
import { db } from "../firebase";
import type { AppUser, AuditLog, School } from "../types";
import { canUseFirestoreData } from "./firestoreData";

const serverTimestamp = (firestore as unknown as { serverTimestamp: () => unknown }).serverTimestamp;
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

type SchoolAiAssistantMutation = { aiAssistant: NonNullable<School["aiAssistant"]>; auditLog: AuditLog };

function assertSuperAdmin(user: AppUser, schoolId: string) {
  if (user.role !== "super_admin" || user.status === "inactive") {
    throw new Error("Seul un Super Administrateur actif peut modifier l’Assistant IA.");
  }
  if (!schoolId) throw new Error("Établissement introuvable.");
}

function buildAuditLog(user: AppUser, schoolId: string, action: string, details: string): AuditLog {
  return { id: globalThis.crypto?.randomUUID?.() ?? `audit-${Date.now()}`, schoolId, actorId: user.id, actorName: user.name, action, details, createdAt: new Date().toISOString() };
}

export async function saveSchoolAiAssistantSetting(user: AppUser, school: Pick<School, "id" | "aiAssistant">, patch: { enabled?: boolean; monthlyLimit?: number }): Promise<SchoolAiAssistantMutation> {
  assertSuperAdmin(user, school.id);
  if (patch.monthlyLimit !== undefined && !validateSchoolAiMonthlyLimit(patch.monthlyLimit)) throw new Error("Le quota mensuel doit être un entier compris entre 1 et 1000.");

  const current = schoolAiUsageThisMonth(school.aiAssistant);
  const localValue = { ...school.aiAssistant, enabled: patch.enabled ?? school.aiAssistant?.enabled === true, monthlyLimit: patch.monthlyLimit ?? current.monthlyLimit, updatedAt: new Date().toISOString(), updatedBy: user.id };
  const enabledChanged = patch.enabled !== undefined && patch.enabled !== (school.aiAssistant?.enabled === true);
  const audit = buildAuditLog(user, school.id,
    enabledChanged ? `${patch.enabled ? "Activation" : "Désactivation"} de l’Assistant IA` : "Modification du quota mensuel de l’Assistant IA",
    enabledChanged
      ? `Ancien statut : ${school.aiAssistant?.enabled === true ? "activé" : "désactivé"}. Nouveau statut : ${patch.enabled ? "activé" : "désactivé"}.`
      : `Ancien quota : ${current.monthlyLimit}. Nouveau quota : ${patch.monthlyLimit ?? current.monthlyLimit}.`);
  if (canUseFirestoreData() && db) {
    const schoolRef = doc(db, "schools", school.id);
    const auditRef = doc(db, "auditLogs", audit.id);
    await runTransaction(db, async (transaction) => {
      const firestorePatch: Record<string, unknown> = { "aiAssistant.updatedAt": serverTimestamp(), "aiAssistant.updatedBy": user.id };
      if (patch.enabled !== undefined) firestorePatch["aiAssistant.enabled"] = patch.enabled;
      if (patch.monthlyLimit !== undefined) firestorePatch["aiAssistant.monthlyLimit"] = patch.monthlyLimit;
      transaction.update(schoolRef, firestorePatch);
      transaction.set(auditRef, { ...audit, createdAt: serverTimestamp() });
    });
    const savedSchool = await getDoc(schoolRef);
    const savedSetting = savedSchool.data()?.aiAssistant as School["aiAssistant"];
    if (savedSetting) return { aiAssistant: savedSetting, auditLog: audit };
  }
  return { aiAssistant: localValue, auditLog: audit };
}

export async function resetSchoolAiMonthlyUsage(user: AppUser, school: Pick<School, "id" | "aiAssistant">): Promise<SchoolAiAssistantMutation> {
  assertSuperAdmin(user, school.id);
  const current = schoolAiUsageThisMonth(school.aiAssistant);
  const localValue = { ...school.aiAssistant, enabled: school.aiAssistant?.enabled === true, monthlyLimit: current.monthlyLimit, monthlyUsage: 0, usageMonth: current.usageMonth, updatedAt: new Date().toISOString(), updatedBy: user.id };
  const audit = buildAuditLog(user, school.id, "Réinitialisation du quota mensuel de l’Assistant IA", `Ancienne consommation : ${current.monthlyUsage}. Nouvelle consommation : 0. Quota mensuel inchangé : ${current.monthlyLimit}.`);
  if (canUseFirestoreData() && db) {
    const schoolRef = doc(db, "schools", school.id);
    const auditRef = doc(db, "auditLogs", audit.id);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(schoolRef);
      if (!snapshot.exists()) throw new Error("Établissement introuvable.");
      const storedUsage = schoolAiUsageThisMonth(snapshot.data()?.aiAssistant as School["aiAssistant"]);
      audit.details = `Ancienne consommation : ${storedUsage.monthlyUsage}. Nouvelle consommation : 0. Quota mensuel inchangé : ${storedUsage.monthlyLimit}.`;
      transaction.update(schoolRef, { "aiAssistant.monthlyUsage": 0, "aiAssistant.usageMonth": storedUsage.usageMonth, "aiAssistant.updatedAt": serverTimestamp(), "aiAssistant.updatedBy": user.id });
      transaction.set(auditRef, { ...audit, createdAt: serverTimestamp() });
    });
    const savedSchool = await getDoc(schoolRef);
    const savedSetting = savedSchool.data()?.aiAssistant as School["aiAssistant"];
    if (savedSetting) return { aiAssistant: savedSetting, auditLog: audit };
  }
  return { aiAssistant: localValue, auditLog: audit };
}
