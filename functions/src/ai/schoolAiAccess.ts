import { HttpsError } from "firebase-functions/v2/https";

type SecretaryAuth = { uid: string; token: Record<string, unknown> } | null | undefined;
type SchoolSnapshot = { exists: boolean; data?: Record<string, unknown> };

export async function assertSecretaryAiEnabled(
  auth: SecretaryAuth,
  requestedSchoolId: unknown,
  readSchool: (schoolId: string) => Promise<SchoolSnapshot>,
) {
  if (!auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  if (auth.token.role !== "secretary") throw new HttpsError("permission-denied", "Action non autorisée.");
  const tokenSchoolId = auth.token.schoolId;
  if (typeof tokenSchoolId !== "string" || typeof requestedSchoolId !== "string" || tokenSchoolId !== requestedSchoolId) {
    throw new HttpsError("permission-denied", "Vous ne disposez pas de l’autorisation nécessaire.");
  }

  const school = await readSchool(tokenSchoolId);
  if (!school.exists) throw new HttpsError("not-found", "Établissement introuvable.");
  const aiAssistant = school.data?.aiAssistant;
  if (!aiAssistant || typeof aiAssistant !== "object" || (aiAssistant as { enabled?: unknown }).enabled !== true) {
    throw new HttpsError("failed-precondition", "L’Assistant IA n’est pas activé pour votre établissement.");
  }
  return school.data ?? {};
}
