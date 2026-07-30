import { HttpsError } from "firebase-functions/v2/https";

export const DEFAULT_AI_MONTHLY_LIMIT = 25;
export const MAX_AI_MONTHLY_LIMIT = 1000;

type SchoolDocument = Record<string, unknown>;
type SchoolSnapshot = { exists: boolean; data(): SchoolDocument | undefined };
type UsageTransaction = {
  get(reference: unknown): Promise<SchoolSnapshot>;
  update(reference: unknown, patch: Record<string, unknown>): void;
};
export type AiUsageDatabase = {
  doc(path: string): unknown;
  runTransaction<T>(operation: (transaction: UsageTransaction) => Promise<T>): Promise<T>;
};

export type SchoolAiUsage = {
  enabled: boolean;
  monthlyLimit: number;
  monthlyUsage: number;
  usageMonth: string;
};

export function utcUsageMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function normalizeSchoolAiUsage(school: SchoolDocument, currentMonth: string): SchoolAiUsage {
  const raw = school.aiAssistant && typeof school.aiAssistant === "object" ? school.aiAssistant as Record<string, unknown> : {};
  const monthlyLimit = Number.isInteger(raw.monthlyLimit) && Number(raw.monthlyLimit) >= 1 && Number(raw.monthlyLimit) <= MAX_AI_MONTHLY_LIMIT
    ? Number(raw.monthlyLimit)
    : DEFAULT_AI_MONTHLY_LIMIT;
  const sameMonth = raw.usageMonth === currentMonth;
  const storedUsage = Number.isInteger(raw.monthlyUsage) && Number(raw.monthlyUsage) >= 0 ? Number(raw.monthlyUsage) : 0;
  return { enabled: raw.enabled === true, monthlyLimit, monthlyUsage: sameMonth ? storedUsage : 0, usageMonth: currentMonth };
}

function assertEnabledAndAvailable(usage: SchoolAiUsage, enforceLimit: boolean) {
  if (!usage.enabled) throw new HttpsError("failed-precondition", "L’Assistant IA n’est pas activé pour cet établissement.");
  if (enforceLimit && usage.monthlyUsage >= usage.monthlyLimit) {
    throw new HttpsError("resource-exhausted", "Le quota mensuel de l’Assistant IA a été atteint pour cet établissement.");
  }
}

export async function prepareSchoolAiUsage(db: AiUsageDatabase, schoolId: string, options: { currentMonth?: string; enforceLimit?: boolean } = {}) {
  const currentMonth = options.currentMonth ?? utcUsageMonth();
  const schoolRef = db.doc(`schools/${schoolId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Établissement introuvable.");
    const school = snapshot.data() ?? {};
    const usage = normalizeSchoolAiUsage(school, currentMonth);
    assertEnabledAndAvailable(usage, options.enforceLimit !== false);
    const raw = school.aiAssistant && typeof school.aiAssistant === "object" ? school.aiAssistant as Record<string, unknown> : {};
    if (raw.usageMonth !== currentMonth || raw.monthlyUsage !== usage.monthlyUsage || raw.monthlyLimit === undefined) {
      transaction.update(schoolRef, {
        "aiAssistant.monthlyLimit": usage.monthlyLimit,
        "aiAssistant.monthlyUsage": usage.monthlyUsage,
        "aiAssistant.usageMonth": currentMonth,
      });
    }
    return { school, usage };
  });
}

export async function incrementSchoolAiUsageAfterSuccess(db: AiUsageDatabase, schoolId: string, currentMonth = utcUsageMonth()) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Établissement introuvable.");
    const usage = normalizeSchoolAiUsage(snapshot.data() ?? {}, currentMonth);
    assertEnabledAndAvailable(usage, true);
    const nextUsage = usage.monthlyUsage + 1;
    transaction.update(schoolRef, {
      "aiAssistant.monthlyLimit": usage.monthlyLimit,
      "aiAssistant.monthlyUsage": nextUsage,
      "aiAssistant.usageMonth": currentMonth,
    });
    return { ...usage, monthlyUsage: nextUsage };
  });
}
