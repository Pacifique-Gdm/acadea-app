import { randomUUID } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { resetSchoolAiUsage, type AiUsageDatabase } from "./schoolAiUsage.js";

export const platformAiResetMonthlyUsage = onCall({ region: "europe-west1", invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  if (request.auth.token.role !== "super_admin") throw new HttpsError("permission-denied", "Action réservée au Super Administrateur.");
  const schoolId = typeof request.data?.schoolId === "string" ? request.data.schoolId : "";
  if (!schoolId) throw new HttpsError("invalid-argument", "Établissement invalide.");
  const db = getFirestore();
  const profile = await db.doc(`users/${request.auth.uid}`).get();
  if (!profile.exists || profile.data()?.role !== "super_admin" || profile.data()?.status !== "active") throw new HttpsError("permission-denied", "Super Administrateur actif requis.");
  const usage = await resetSchoolAiUsage(db as unknown as AiUsageDatabase, { schoolId, actorId: request.auth.uid, actorRole: request.auth.token.role, now: FieldValue.serverTimestamp() });
  await db.collection("auditLogs").doc(randomUUID()).set({ schoolId, actorId: request.auth.uid, action: "Réinitialisation du quota mensuel de l’Assistant IA", details: `Nouvelle consommation : 0. Quota mensuel inchangé : ${usage.monthlyLimit}.`, createdAt: FieldValue.serverTimestamp() });
  const school = await db.doc(`schools/${schoolId}`).get();
  return { aiAssistant: school.data()?.aiAssistant ?? null };
});
