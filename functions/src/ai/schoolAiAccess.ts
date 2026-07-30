import { HttpsError } from "firebase-functions/v2/https";

export type SecretaryAuth = { uid: string; token: Record<string, unknown> } | null | undefined;

export function assertSecretaryAiIdentity(auth: SecretaryAuth, requestedSchoolId: unknown) {
  if (!auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  if (auth.token.role !== "secretary") throw new HttpsError("permission-denied", "Action non autorisée.");
  const tokenSchoolId = auth.token.schoolId;
  if (typeof tokenSchoolId !== "string" || typeof requestedSchoolId !== "string" || tokenSchoolId !== requestedSchoolId) {
    throw new HttpsError("permission-denied", "Vous ne disposez pas de l’autorisation nécessaire.");
  }
  return { auth, schoolId: tokenSchoolId };
}
