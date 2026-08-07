import { HttpsError } from "firebase-functions/v2/https";

export const DEFAULT_AI_MONTHLY_LIMIT = 25;
export const MAX_AI_MONTHLY_LIMIT = 1000;

type DocumentData = Record<string, unknown>;
type DocumentSnapshot = { exists: boolean; data(): DocumentData | undefined };
type UsageTransaction = {
  get(reference: unknown): Promise<DocumentSnapshot>;
  set(reference: unknown, value: DocumentData, options?: { merge: boolean }): void;
  update(reference: unknown, patch: DocumentData): void;
};
export type AiUsageDatabase = {
  doc(path: string): unknown;
  runTransaction<T>(operation: (transaction: UsageTransaction) => Promise<T>): Promise<T>;
};

export type SchoolAiUsage = { enabled: boolean; monthlyLimit: number; monthlyUsage: number; usageMonth: string };

export function utcUsageMonth(date = new Date()) { return date.toISOString().slice(0, 7); }

export function normalizeSchoolAiUsage(school: DocumentData, currentMonth: string): SchoolAiUsage {
  const raw = school.aiAssistant && typeof school.aiAssistant === "object" ? school.aiAssistant as DocumentData : {};
  const monthlyLimit = Number.isInteger(raw.monthlyLimit) && Number(raw.monthlyLimit) >= 1 && Number(raw.monthlyLimit) <= MAX_AI_MONTHLY_LIMIT ? Number(raw.monthlyLimit) : DEFAULT_AI_MONTHLY_LIMIT;
  const storedUsage = Number.isInteger(raw.monthlyUsage) && Number(raw.monthlyUsage) >= 0 ? Number(raw.monthlyUsage) : 0;
  return { enabled: raw.enabled === true, monthlyLimit, monthlyUsage: raw.usageMonth === currentMonth ? storedUsage : 0, usageMonth: currentMonth };
}

function assertEnabled(usage: SchoolAiUsage) {
  if (!usage.enabled) throw new HttpsError("failed-precondition", "L’Assistant IA n’est pas activé pour cet établissement.");
}

function assertSchoolActive(school: DocumentData) {
  if (school.status !== "active") throw new HttpsError("failed-precondition", "L’établissement n’est pas actif.");
}

function assertQuotaAvailable(usage: SchoolAiUsage) {
  if (usage.monthlyUsage >= usage.monthlyLimit) throw new HttpsError("resource-exhausted", "Le quota mensuel de l’Assistant IA a été atteint pour cet établissement.");
}

function reservationPath(schoolId: string, idempotencyKey: string) { return `schools/${schoolId}/aiUsageReservations/${idempotencyKey}`; }

export async function prepareSchoolAiUsage(db: AiUsageDatabase, schoolId: string, options: { currentMonth?: string; enforceLimit?: boolean } = {}) {
  const currentMonth = options.currentMonth ?? utcUsageMonth();
  const schoolRef = db.doc(`schools/${schoolId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Établissement introuvable.");
    const school = snapshot.data() ?? {};
    assertSchoolActive(school);
    const usage = normalizeSchoolAiUsage(school, currentMonth);
    assertEnabled(usage);
    if (options.enforceLimit !== false) assertQuotaAvailable(usage);
    return { school, usage };
  });
}

export async function reserveSchoolAiUsage(db: AiUsageDatabase, input: { schoolId: string; userId: string; idempotencyKey: string; currentMonth?: string; now?: string }) {
  const currentMonth = input.currentMonth ?? utcUsageMonth();
  const schoolRef = db.doc(`schools/${input.schoolId}`);
  const reservationRef = db.doc(reservationPath(input.schoolId, input.idempotencyKey));
  return db.runTransaction(async (transaction) => {
    const [schoolSnapshot, reservationSnapshot] = await Promise.all([transaction.get(schoolRef), transaction.get(reservationRef)]);
    if (!schoolSnapshot.exists) throw new HttpsError("not-found", "Établissement introuvable.");
    const school = schoolSnapshot.data() ?? {};
    assertSchoolActive(school);
    const usage = normalizeSchoolAiUsage(school, currentMonth);
    assertEnabled(usage);
    const existing = reservationSnapshot.exists ? reservationSnapshot.data() ?? {} : undefined;
    if (existing && existing.status !== "released") throw new HttpsError("already-exists", "Cette demande IA a déjà été prise en compte.");
    if (existing && (existing.schoolId !== input.schoolId || existing.userId !== input.userId)) throw new HttpsError("permission-denied", "Réservation IA invalide.");
    assertQuotaAvailable(usage);
    const nextUsage = usage.monthlyUsage + 1;
    transaction.update(schoolRef, { "aiAssistant.monthlyLimit": usage.monthlyLimit, "aiAssistant.monthlyUsage": nextUsage, "aiAssistant.usageMonth": currentMonth });
    transaction.set(reservationRef, { schoolId: input.schoolId, userId: input.userId, usageMonth: currentMonth, status: "reserved", reservedAt: input.now ?? new Date().toISOString() }, { merge: false });
    return { school, usage: { ...usage, monthlyUsage: nextUsage }, status: "reserved" as const };
  });
}

export async function completeSchoolAiUsage(db: AiUsageDatabase, schoolId: string, userId: string, idempotencyKey: string, now = new Date().toISOString()) {
  const reference = db.doc(reservationPath(schoolId, idempotencyKey));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const reservation = snapshot.data() ?? {};
    if (!snapshot.exists || reservation.schoolId !== schoolId || reservation.userId !== userId) throw new HttpsError("not-found", "Réservation IA introuvable.");
    if (reservation.status === "completed") return "completed" as const;
    if (reservation.status !== "reserved") throw new HttpsError("failed-precondition", "La réservation IA n’est plus active.");
    transaction.update(reference, { status: "completed", completedAt: now });
    return "completed" as const;
  });
}

export async function releaseSchoolAiUsage(db: AiUsageDatabase, schoolId: string, userId: string, idempotencyKey: string, currentMonth = utcUsageMonth(), now = new Date().toISOString()) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  const reservationRef = db.doc(reservationPath(schoolId, idempotencyKey));
  return db.runTransaction(async (transaction) => {
    const [schoolSnapshot, reservationSnapshot] = await Promise.all([transaction.get(schoolRef), transaction.get(reservationRef)]);
    const reservation = reservationSnapshot.data() ?? {};
    if (!schoolSnapshot.exists || !reservationSnapshot.exists || reservation.schoolId !== schoolId || reservation.userId !== userId || reservation.status !== "reserved") return "unchanged" as const;
    const usage = normalizeSchoolAiUsage(schoolSnapshot.data() ?? {}, currentMonth);
    if (reservation.usageMonth === currentMonth) transaction.update(schoolRef, { "aiAssistant.monthlyUsage": Math.max(0, usage.monthlyUsage - 1), "aiAssistant.usageMonth": currentMonth });
    transaction.update(reservationRef, { status: "released", releasedAt: now });
    return "released" as const;
  });
}

export async function resetSchoolAiUsage(db: AiUsageDatabase, input: { schoolId: string; actorId: string; actorRole: unknown; currentMonth?: string; now?: unknown }) {
  if (input.actorRole !== "super_admin") throw new HttpsError("permission-denied", "Action réservée au Super Administrateur.");
  const currentMonth = input.currentMonth ?? utcUsageMonth();
  const schoolRef = db.doc(`schools/${input.schoolId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(schoolRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Établissement introuvable.");
    const usage = normalizeSchoolAiUsage(snapshot.data() ?? {}, currentMonth);
    transaction.update(schoolRef, { "aiAssistant.monthlyLimit": usage.monthlyLimit, "aiAssistant.monthlyUsage": 0, "aiAssistant.usageMonth": currentMonth, "aiAssistant.updatedAt": input.now ?? new Date().toISOString(), "aiAssistant.updatedBy": input.actorId });
    return { ...usage, monthlyUsage: 0 };
  });
}
