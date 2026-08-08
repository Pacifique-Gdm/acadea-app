import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resetSchoolAiUsage, type AiUsageDatabase } from "./schoolAiUsage.js";
import { FUNCTION_AUDIT_EVENTS, functionServerAudit } from "../audit/serverAudit.js";
import { enforceCallableRateLimit, FUNCTION_RATE_LIMITS, type RateLimitDatabase } from "../security/rateLimit.js";

export const platformAiResetMonthlyUsage = onCall({ region: "europe-west1", invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  if (request.auth.token.role !== "super_admin") throw new HttpsError("permission-denied", "Action réservée au Super Administrateur.");
  const schoolId = typeof request.data?.schoolId === "string" ? request.data.schoolId : "";
  if (!schoolId) throw new HttpsError("invalid-argument", "Établissement invalide.");
  const db = getFirestore();
  const profile = await db.doc(`users/${request.auth.uid}`).get();
  if (!profile.exists || profile.data()?.role !== "super_admin" || profile.data()?.status !== "active") throw new HttpsError("permission-denied", "Super Administrateur actif requis.");
  await enforceCallableRateLimit({ db: db as unknown as RateLimitDatabase, actorId: request.auth.uid, schoolId, action: "ai.quota.reset", ...FUNCTION_RATE_LIMITS.AI_RESET });
  const usage = await resetSchoolAiUsage(db as unknown as AiUsageDatabase, { schoolId, actorId: request.auth.uid, actorRole: request.auth.token.role, now: FieldValue.serverTimestamp() });
  const auditId = randomUUID();
  await db.collection("auditLogs").doc(auditId).set(functionServerAudit({ id: auditId, eventType: FUNCTION_AUDIT_EVENTS.AI_QUOTA_RESET, actor: { uid: request.auth.uid, role: String(request.auth.token.role) }, schoolId, resourceType: "schoolAiAssistant", resourceId: schoolId, metadata: { monthlyLimit: usage.monthlyLimit } }));
  const school = await db.doc(`schools/${schoolId}`).get();
  return { aiAssistant: school.data()?.aiAssistant ?? null };
});

export const platformAiUpdateSettings = onCall({ region: "europe-west1", invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  if (request.auth.token.role !== "super_admin") throw new HttpsError("permission-denied", "Action réservée au Super Administrateur.");
  const schoolId = typeof request.data?.schoolId === "string" ? request.data.schoolId : "";
  const enabled = typeof request.data?.enabled === "boolean" ? request.data.enabled : undefined;
  const monthlyLimit = Number.isInteger(request.data?.monthlyLimit) && request.data.monthlyLimit >= 1 && request.data.monthlyLimit <= 1000 ? Number(request.data.monthlyLimit) : undefined;
  if (!schoolId || (enabled === undefined && monthlyLimit === undefined)) throw new HttpsError("invalid-argument", "Paramètres IA invalides.");
  const db = getFirestore();
  const [profile, school] = await Promise.all([db.doc(`users/${request.auth.uid}`).get(), db.doc(`schools/${schoolId}`).get()]);
  if (!profile.exists || profile.data()?.role !== "super_admin" || profile.data()?.status !== "active") throw new HttpsError("permission-denied", "Super Administrateur actif requis.");
  if (!school.exists) throw new HttpsError("not-found", "Établissement introuvable.");
  await enforceCallableRateLimit({ db: db as unknown as RateLimitDatabase, actorId: request.auth.uid, schoolId, action: "ai.settings.update", ...FUNCTION_RATE_LIMITS.AI_SETTINGS });
  const current = school.data()?.aiAssistant ?? {};
  const patch: Record<string, unknown> = { "aiAssistant.updatedAt": FieldValue.serverTimestamp(), "aiAssistant.updatedBy": request.auth.uid };
  if (enabled !== undefined) patch["aiAssistant.enabled"] = enabled;
  if (monthlyLimit !== undefined) patch["aiAssistant.monthlyLimit"] = monthlyLimit;
  const eventType = enabled !== undefined && enabled !== (current.enabled === true) ? enabled ? FUNCTION_AUDIT_EVENTS.AI_ENABLED : FUNCTION_AUDIT_EVENTS.AI_DISABLED : FUNCTION_AUDIT_EVENTS.AI_LIMIT_UPDATED;
  const auditId = randomUUID();
  const batch = db.batch();
  batch.update(db.doc(`schools/${schoolId}`), patch);
  batch.set(db.doc(`auditLogs/${auditId}`), functionServerAudit({ id: auditId, eventType, actor: { uid: request.auth.uid, role: "super_admin" }, schoolId, resourceType: "schoolAiAssistant", resourceId: schoolId, metadata: { ...(enabled !== undefined ? { enabled } : {}), ...(monthlyLimit !== undefined ? { monthlyLimit } : {}) } }));
  await batch.commit();
  return { aiAssistant: (await db.doc(`schools/${schoolId}`).get()).data()?.aiAssistant ?? null };
});
