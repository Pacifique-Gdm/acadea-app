import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "../firebase";
import type { AppUser } from "../types";
import type { AiWritingRequest, AiWritingResponse } from "../modules/secretary/aiWritingTypes";

export function assertSecretaryAiAccess(user: AppUser, schoolId: string) {
  if (!app || !auth?.currentUser || auth.currentUser.uid !== user.id || user.role !== "secretary" || user.status === "inactive" || user.schoolId !== schoolId) throw new Error("Vous ne disposez pas de l'autorisation nécessaire.");
}

export async function requestSecretaryAi(user: AppUser, input: AiWritingRequest) {
  assertSecretaryAiAccess(user, input.schoolId);
  const callable = httpsCallable<AiWritingRequest, AiWritingResponse>(getFunctions(app!, "europe-west1"), "secretaryAiWritingAssistant", { timeout: 60000 });
  const result = await callable(input);
  if (!result.data?.success || !Array.isArray(result.data.warnings) || !Array.isArray(result.data.missingInformation)) throw new Error("La réponse de l'assistant IA est invalide.");
  return result.data;
}

export async function recordSecretaryAiDecision(user: AppUser, schoolId: string, requestId: string, accepted: boolean) {
  assertSecretaryAiAccess(user, schoolId);
  const callable = httpsCallable<{ requestId: string; accepted: boolean }, { success: boolean }>(getFunctions(app!, "europe-west1"), "secretaryAiRecordDecision");
  await callable({ requestId, accepted });
}

export function aiErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const callableMessage = error instanceof Error ? error.message.replace(/^FirebaseError:\s*/i, "").trim() : "";
  const exploitableMessage = callableMessage && !/^(internal|unavailable|unknown|error)$/i.test(callableMessage) ? callableMessage : "";
  if (exploitableMessage && ["failed-precondition", "deadline-exceeded", "resource-exhausted", "unavailable", "internal", "invalid-argument"].some((item) => code.includes(item))) return exploitableMessage;
  if (code.includes("not-found")) return "Le service Assistant IA n'est pas encore disponible sur cet environnement.";
  if (code.includes("failed-precondition")) return "L'Assistant IA n'est pas configuré pour cet établissement.";
  if (code.includes("unauthenticated")) return "Votre session a expiré. Reconnectez-vous avant d'utiliser l'Assistant IA.";
  if (code.includes("permission-denied")) return "Vous ne disposez pas de l'autorisation nécessaire.";
  if (code.includes("deadline-exceeded")) return "Le délai d'attente est dépassé. Votre texte n'a pas été modifié.";
  if (code.includes("resource-exhausted")) return "La limite d'utilisation de l'Assistant IA est atteinte.";
  if (code.includes("unavailable") || code.includes("internal")) return "Le service IA est temporairement indisponible. Votre texte n'a pas été modifié.";
  if (code.includes("invalid-argument")) return error instanceof Error ? error.message : "Le texte envoyé est invalide ou trop long.";
  return "L'assistant IA est temporairement indisponible. Votre texte n'a pas été modifié.";
}
