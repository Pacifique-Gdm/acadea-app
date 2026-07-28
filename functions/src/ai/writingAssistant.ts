import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { AI_ACTIONS, type AiAction, type AiWritingRequest, type AiWritingResponse } from "./types.js";
import { sanitizeAiContext, sanitizeAiText } from "./sanitize.js";

const openAiApiKey = defineSecret("OPENAI_API_KEY");
const coreActions = new Set<AiAction>(["correct", "reformulate", "formalize", "generate_draft", "verify_document"]);
const allowedDocuments = new Set(["outgoing_correspondence", "meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]);
const responseSchema = {
  type: "object", additionalProperties: false,
  properties: {
    proposedText: { type: "string" },
    sections: { type: "object", additionalProperties: { type: "string" } },
    warnings: { type: "array", items: { type: "object", additionalProperties: false, properties: { code: { type: "string" }, severity: { type: "string", enum: ["info", "warning", "critical"] }, title: { type: "string" }, message: { type: "string" }, field: { type: "string" } }, required: ["code", "severity", "title", "message", "field"] } },
    missingInformation: { type: "array", items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, message: { type: "string" } }, required: ["field", "message"] } },
  }, required: ["proposedText", "sections", "warnings", "missingInformation"],
};

function validateInput(value: unknown): AiWritingRequest {
  if (!value || typeof value !== "object") throw new HttpsError("invalid-argument", "Demande IA invalide.");
  const input = value as Partial<AiWritingRequest>;
  if (!input.schoolId || !input.documentType || !input.action || !AI_ACTIONS.includes(input.action) || !coreActions.has(input.action) || !allowedDocuments.has(input.documentType)) throw new HttpsError("invalid-argument", "Action ou document non pris en charge.");
  if (input.consentConfirmed !== true) throw new HttpsError("failed-precondition", "Le consentement de vérification humaine est requis.");
  return input as AiWritingRequest;
}

function buildInstructions(input: AiWritingRequest) {
  return `Tu es l'assistant rédactionnel administratif d'Acadéa. Écris uniquement en français correct. Tu proposes un brouillon à vérifier humainement. N'invente jamais de fait, personne, date, référence, montant, décision, sanction, vote ou signature. Préserve strictement les noms propres, dates, références, montants et numéros fournis. Si une information manque, utilise un marqueur [INFORMATION À PRÉCISER] et renseigne missingInformation. Ne génère jamais l'en-tête, la référence automatique, le statut, le signataire, la signature, le cachet ou les données d'envoi. Pour une correction, préserve le sens et limite les changements à la langue. Pour un incident, distingue faits et suppositions et garde un ton neutre. Pour une vérification, ne réécris pas silencieusement : retourne des avertissements structurés. Action: ${input.action}. Document: ${input.documentType}. Section: ${input.section ?? "document complet"}. Ton: ${input.tone ?? "administrative"}. Longueur: ${input.length ?? "similar"}. Instruction complémentaire: ${input.additionalInstruction ?? "aucune"}.`;
}

function parseProviderResponse(value: unknown, action: AiAction, originalText: string, requestId: string): AiWritingResponse {
  if (!value || typeof value !== "object") throw new HttpsError("internal", "Réponse IA invalide.");
  const data = value as Record<string, unknown>;
  const sections = data.sections && typeof data.sections === "object" && !Array.isArray(data.sections) ? Object.fromEntries(Object.entries(data.sections as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter((item) => item && typeof item === "object" && typeof (item as { message?: unknown }).message === "string") : [];
  const missingInformation = Array.isArray(data.missingInformation) ? data.missingInformation.filter((item) => item && typeof item === "object" && typeof (item as { field?: unknown }).field === "string") : [];
  const proposedText = typeof data.proposedText === "string" ? data.proposedText.trim() : "";
  if (!proposedText && Object.keys(sections).length === 0 && warnings.length === 0) throw new HttpsError("internal", "La proposition IA est vide.");
  return { success: true, action, originalText, proposedText, sections, warnings: warnings as AiWritingResponse["warnings"], missingInformation: missingInformation as AiWritingResponse["missingInformation"], metadata: { requestId, generatedAt: new Date().toISOString() } };
}

export const secretaryAiWritingAssistant = onCall({ region: "europe-west1", timeoutSeconds: 60, memory: "256MiB", secrets: [openAiApiKey] }, async (request) => {
  const startedAt = Date.now(); const requestId = randomUUID(); const input = validateInput(request.data);
  const role = request.auth?.token.role; const schoolId = request.auth?.token.schoolId;
  if (!request.auth || role !== "secretary" || typeof schoolId !== "string" || schoolId !== input.schoolId) throw new HttpsError("permission-denied", "Vous ne disposez pas de l'autorisation nécessaire.");
  const db = getFirestore();
  const school = await db.doc(`schools/${schoolId}`).get();
  if (!school.exists) throw new HttpsError("not-found", "Établissement introuvable.");
  const settings = (school.data()?.aiSettings ?? {}) as Record<string, unknown>;
  if (settings.enabled === false || (Array.isArray(settings.allowedRoles) && !settings.allowedRoles.includes("secretary")) || (Array.isArray(settings.allowedActions) && !settings.allowedActions.includes(input.action))) throw new HttpsError("permission-denied", "L'assistant IA n'est pas autorisé pour cette action.");
  const maxCharacters = typeof settings.maxInputCharacters === "number" ? Math.min(settings.maxInputCharacters, 20000) : 12000;
  const original = sanitizeAiText(input.originalText ?? "");
  const context = sanitizeAiContext(input.context ?? {});
  const sentCharacters = original.sanitized.length + JSON.stringify(context).length;
  if (sentCharacters > maxCharacters) throw new HttpsError("invalid-argument", `Le texte dépasse la limite de ${maxCharacters} caractères.`);
  const apiKey = openAiApiKey.value(); if (!apiKey) throw new HttpsError("failed-precondition", "L'assistant IA n'est pas configuré.");
  let result: AiWritingResponse; let providerStatus = "failed"; const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, store: false, instructions: buildInstructions(input), input: JSON.stringify({ text: original.sanitized, context }), text: { format: { type: "json_schema", name: "acadea_writing_response", strict: true, schema: responseSchema } } }) }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    const provider = await response.json() as { output_text?: unknown };
    if (typeof provider.output_text !== "string") throw new Error("provider_empty_response");
    result = parseProviderResponse(JSON.parse(provider.output_text), input.action, input.originalText ?? "", requestId); providerStatus = "success";
    if (original.detected.length) result.warnings.unshift({ code: "sensitive_data_masked", severity: "warning", title: "Données sensibles masquées", message: "Certaines informations sensibles ont été retirées avant l'envoi.", field: input.section ?? "document" });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(error instanceof Error && error.name === "AbortError" ? "deadline-exceeded" : "unavailable", "L'assistant IA est temporairement indisponible. Votre texte n'a pas été modifié.");
  } finally {
    await db.collection("aiUsageLogs").doc(requestId).set({ schoolId, userId: request.auth.uid, role, documentType: input.documentType, documentId: input.documentId ?? null, section: input.section ?? null, action: input.action, createdAt: FieldValue.serverTimestamp(), status: providerStatus, provider: "openai", model, durationMs: Date.now() - startedAt, sentCharacters, receivedCharacters: typeof result! === "object" ? JSON.stringify(result!).length : 0, accepted: null });
  }
  return result;
});

export const secretaryAiRecordDecision = onCall({ region: "europe-west1" }, async (request) => {
  if (!request.auth || request.auth.token.role !== "secretary") throw new HttpsError("permission-denied", "Action non autorisée.");
  const requestId = typeof request.data?.requestId === "string" ? request.data.requestId : "";
  const accepted = request.data?.accepted;
  if (!requestId || typeof accepted !== "boolean") throw new HttpsError("invalid-argument", "Décision invalide.");
  const reference = getFirestore().collection("aiUsageLogs").doc(requestId); const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.userId !== request.auth.uid || snapshot.data()?.schoolId !== request.auth.token.schoolId) throw new HttpsError("permission-denied", "Historique inaccessible.");
  await reference.update({ accepted, decisionAt: FieldValue.serverTimestamp(), acceptedBy: request.auth.uid });
  return { success: true };
});
