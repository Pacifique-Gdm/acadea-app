import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { AI_ACTIONS, AI_LENGTHS, AI_TONES, type AiAction, type AiWritingRequest, type AiWritingResponse } from "./types.js";
import { sanitizeAiContext, sanitizeAiText } from "./sanitize.js";
import { buildSingleSectionWritingResponseFormat, buildStructuredWritingResponseFormat, classifyOpenAiFailure, extractOpenAiResponseText, normalizeOpenAiSections, OPENAI_WRITING_RESPONSE_FORMAT, readOpenAiFailure } from "./openAiResponse.js";
import { assertSecretaryAiIdentity } from "./schoolAiAccess.js";
import { incrementSchoolAiUsageAfterSuccess, prepareSchoolAiUsage, type AiUsageDatabase } from "./schoolAiUsage.js";

const openAiApiKey = defineSecret("OPENAI_API_KEY");
export const AI_ASSISTANT_VERSION = "2026-07-30-actions-v2";
const FUNCTION_REGION = "europe-west1";
const coreActions = new Set<AiAction>(AI_ACTIONS);
const allowedDocuments = new Set(["outgoing_correspondence", "meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]);
export const REPORT_SECTION_FIELDS: Record<string, string[]> = {
  meeting_minutes: ["location", "subject", "participants", "discussedPoints", "decisions", "recommendations", "signatures"],
  official_minutes: ["location", "subject", "participants", "agenda", "proceedings", "resolutions", "signatures"],
  incident_report: ["location", "peopleConcerned", "factsDescription", "measuresTaken", "recommendations", "author"],
  activity_report: ["period", "departmentOrActivity", "objectives", "completedActivities", "results", "difficulties", "recommendations", "author"],
  administrative_note: ["number", "subject", "recipients", "effectiveDate", "content", "signer"],
  other: ["subject", "structuredSections", "author", "signatures"],
};
function firebaseProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try { return JSON.parse(process.env.FIREBASE_CONFIG ?? "{}").projectId ?? "unknown"; } catch { return "unknown"; }
}
function diagnosticLoggingEnabled(projectId = firebaseProjectId()) { return process.env.NODE_ENV !== "production" || /staging|dev|test/i.test(projectId); }
function unsupportedInputDetails(input: Partial<AiWritingRequest>) {
  return { actionReceived: input.action ?? null, acceptedActions: [...AI_ACTIONS], documentCategoryReceived: input.documentCategory ?? null, documentTypeReceived: input.documentType ?? null, version: AI_ASSISTANT_VERSION };
}
export function validateInput(value: unknown): AiWritingRequest {
  if (!value || typeof value !== "object") throw new HttpsError("invalid-argument", "Demande IA invalide.", { version: AI_ASSISTANT_VERSION });
  const input = value as Partial<AiWritingRequest>;
  if (!input.schoolId || !input.documentType || !input.documentTypeLabel?.trim() || !["courrier", "rapport"].includes(input.documentCategory ?? "") || !input.action || !AI_ACTIONS.includes(input.action) || !coreActions.has(input.action) || !allowedDocuments.has(input.documentType)) throw new HttpsError("invalid-argument", "Action ou document non pris en charge.", unsupportedInputDetails(input));
  if (!input.scope || !input.tone || !AI_TONES.includes(input.tone) || !input.length || !AI_LENGTHS.includes(input.length) || typeof input.additionalInstruction !== "string" || !input.sections || typeof input.sections !== "object" || Array.isArray(input.sections) || !input.documentContext || typeof input.documentContext !== "object" || Array.isArray(input.documentContext)) throw new HttpsError("invalid-argument", "Paramètres ou contexte du document invalides.", { acceptedTones: AI_TONES, acceptedLengths: AI_LENGTHS, version: AI_ASSISTANT_VERSION });
  if (input.documentCategory === "rapport") {
    const sections = input.sections;
    const expectedFields = REPORT_SECTION_FIELDS[input.documentType];
    const receivedFields = Object.keys(sections);
    const requestedFields = input.scope === "full_document" ? expectedFields ?? [] : expectedFields?.includes(input.scope) ? [input.scope] : [];
    const targetValid = input.scope === "full_document" ? input.targetSection === undefined : input.targetSection?.key === input.scope && input.targetSection.value === sections[input.scope];
    if (!expectedFields || !targetValid || receivedFields.length !== requestedFields.length || requestedFields.some((field) => typeof sections[field] !== "string") || receivedFields.some((field) => !requestedFields.includes(field))) throw new HttpsError("invalid-argument", "Sections du rapport invalides.", { expectedFields: requestedFields, version: AI_ASSISTANT_VERSION });
  } else if (Object.values(input.sections).some((value) => typeof value !== "string")) throw new HttpsError("invalid-argument", "Sections du document invalides.", { version: AI_ASSISTANT_VERSION });
  if (input.consentConfirmed !== true) throw new HttpsError("failed-precondition", "Le consentement de vérification humaine est requis.");
  return input as AiWritingRequest;
}

export function buildInstructions(input: AiWritingRequest) {
  const actionInstructions: Record<AiAction, string> = {
    write_complete: "Produis un document complet, structuré et développé à partir de toutes les informations disponibles. Construis une introduction, un développement et une conclusion lorsque le document l'exige. Transforme même des notes brèves en document professionnel complet ; ne te limite jamais à corriger ou reformuler le texte initial.",
    develop: "Enrichis fortement le contenu avec des explications, transitions et précisions pertinentes. Conserve strictement les faits fournis et n'invente aucun nom, date, décision ou événement.",
    improve: "Réécris le document pour améliorer nettement sa clarté, sa fluidité, sa cohérence, sa structure et son professionnalisme. Des modifications importantes sont autorisées si elles améliorent réellement le résultat sans changer les faits.",
    reformulate: "Réécris entièrement le contenu en conservant le sens, les faits et le niveau de détail. Ne te limite pas à quelques remplacements de mots.",
    correct: "Corrige uniquement l'orthographe, la grammaire, la syntaxe, la conjugaison et la ponctuation, en conservant le fond du document.",
    formalize: "Adopte un ton formel, institutionnel, neutre et respectueux et structure le document selon les pratiques administratives scolaires. Supprime les formulations familières, ambiguës ou émotionnelles sans inventer de faits.",
    summarize: "Réduis le document tout en conservant les faits, décisions et informations essentiels.",
    clarify: "Rends le texte plus précis et compréhensible et corrige les ambiguïtés sans en changer le sens.",
    professionalize: "Renforce la qualité rédactionnelle, la cohérence, la structure et la présentation professionnelle du document sans altérer les faits.",
  };
  const toneInstructions: Record<AiWritingRequest["tone"], string> = { neutral: "Adopte un ton neutre.", administrative: "Adopte un ton administratif.", formal: "Adopte un ton formel.", professional: "Adopte un ton professionnel.", concise: "Adopte un style concis.", diplomatic: "Adopte un ton diplomatique." };
  const lengthInstructions: Record<AiWritingRequest["length"], string> = { short: "Produis une version courte et directe.", standard: "Produis une version équilibrée.", developed: "Produis une version détaillée, structurée et approfondie sans élargir la portée." };
  const context = input.documentContext;
  const structuredReportInstruction = input.documentCategory === "rapport" ? input.scope === "full_document" ? ` Traite chaque section séparément et retourne les clés suivantes : ${Object.keys(input.sections).join(", ")}. Ne déplace jamais une information d'une section vers une autre. La section decisions contient uniquement les décisions prises ; recommendations contient uniquement les suites conseillées. N'invente jamais de signataire.` : ` Tu modifies uniquement la section ${input.scope}. Ne réécris et ne retourne aucune autre section. N'invente jamais de signataire.` : "";
  return `Tu es l'assistant rédactionnel administratif d'Acadéa. Écris uniquement en français correct. Tu proposes un brouillon à vérifier humainement. N'invente jamais de fait, personne, date, référence, montant, décision, sanction, vote ou signature. Préserve strictement les noms propres, dates, références, montants et numéros fournis. Ne génère jamais l'en-tête, la référence automatique, le statut, le signataire, la signature, le cachet ou les données d'envoi. Portée : ${input.scope}. Action : ${input.action}. Ton : ${input.tone}. Longueur : ${input.length}. Instruction complémentaire : ${input.additionalInstruction || "aucune"}. ${actionInstructions[input.action]} ${toneInstructions[input.tone]} ${lengthInstructions[input.length]}${structuredReportInstruction} Informations du document : catégorie=${input.documentCategory}; type=${input.documentTypeLabel}; date=${context.date || input.documentDate || "non fournie"}; heure=${context.time || input.documentTime || "non fournie"}; heure de fin=${context.endTime || "non fournie"}; établissement=${context.schoolName || input.schoolId}; année scolaire=${context.academicYearName || input.academicYearId || "non fournie"}. Utilise les date et heure fournies. Ne déclare pas qu'elles sont manquantes lorsqu'elles existent. Ne les invente pas lorsqu'elles sont absentes.`;
}

export function parseProviderResponse(value: unknown, input: AiWritingRequest, requestId: string): AiWritingResponse {
  if (!value || typeof value !== "object") throw new HttpsError("internal", "Réponse IA invalide.");
  const data = value as Record<string, unknown>;
  const providerSection = data.section && typeof data.section === "object" ? data.section as { key?: unknown; value?: unknown } : undefined;
  const section = typeof providerSection?.key === "string" && typeof providerSection.value === "string" && providerSection.key === input.scope ? { key: providerSection.key, value: providerSection.value } : undefined;
  const sections = input.scope === "full_document" ? normalizeOpenAiSections(data.sections) : section ? { [section.key]: section.value } : {};
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter((item) => item && typeof item === "object" && typeof (item as { message?: unknown }).message === "string") : [];
  const missingInformation = Array.isArray(data.missingInformation) ? data.missingInformation.filter((item) => item && typeof item === "object" && typeof (item as { field?: unknown }).field === "string") : [];
  const proposedText = typeof data.proposedText === "string" ? data.proposedText.trim() : "";
  if (!proposedText && Object.keys(sections).length === 0 && warnings.length === 0) throw new HttpsError("internal", "La proposition IA est vide.");
  return { success: true, action: input.action, scope: input.scope, originalText: input.originalText ?? "", proposedText, ...(section ? { section } : {}), sections, warnings: warnings as AiWritingResponse["warnings"], missingInformation: missingInformation as AiWritingResponse["missingInformation"], metadata: { requestId, generatedAt: new Date().toISOString(), version: AI_ASSISTANT_VERSION } };
}

export const secretaryAiWritingAssistant = onCall({ region: FUNCTION_REGION, timeoutSeconds: 60, memory: "256MiB", secrets: [openAiApiKey], invoker: "public" }, async (request) => {
  const startedAt = Date.now(); const requestId = randomUUID();
  const rawInput = request.data && typeof request.data === "object" ? request.data as Partial<AiWritingRequest> : {};
  const projectId = firebaseProjectId();
  if (diagnosticLoggingEnabled(projectId)) logger.info("Secretary AI request diagnostic", { version: AI_ASSISTANT_VERSION, action: rawInput.action ?? null, scope: rawInput.scope ?? null, documentCategory: rawInput.documentCategory ?? null, documentType: rawInput.documentType ?? null, documentTypeLabel: rawInput.documentTypeLabel ?? null, sectionKeysReceived: rawInput.sections && typeof rawInput.sections === "object" ? Object.keys(rawInput.sections) : [], projectId, region: FUNCTION_REGION });
  const input = validateInput(request.data);
  if (diagnosticLoggingEnabled(projectId)) logger.info("Secretary AI validated request", { action: input.action, scope: input.scope, sectionKeysReceived: Object.keys(input.sections) });
  const db = getFirestore();
  const { auth, schoolId } = assertSecretaryAiIdentity(request.auth, input.schoolId);
  const usageDatabase = db as unknown as AiUsageDatabase;
  const { school: schoolData } = await prepareSchoolAiUsage(usageDatabase, schoolId);
  const role = auth.token.role;
  const settings = (schoolData.aiSettings ?? {}) as Record<string, unknown>;
  if ((Array.isArray(settings.allowedRoles) && !settings.allowedRoles.includes("secretary")) || (Array.isArray(settings.allowedActions) && !settings.allowedActions.includes(input.action))) throw new HttpsError("permission-denied", "L'assistant IA n'est pas autorisé pour cette action.");
  const maxCharacters = typeof settings.maxInputCharacters === "number" ? Math.min(settings.maxInputCharacters, 20000) : 12000;
  const original = sanitizeAiText(input.originalText ?? "");
  const context = sanitizeAiContext({ ...input.context, sections: input.sections, documentContext: input.documentContext, documentDate: input.documentDate, documentTime: input.documentTime });
  const sentCharacters = original.sanitized.length + JSON.stringify(context).length;
  if (sentCharacters > maxCharacters) throw new HttpsError("invalid-argument", `Le texte dépasse la limite de ${maxCharacters} caractères.`);
  const apiKey = openAiApiKey.value(); if (!apiKey) throw new HttpsError("failed-precondition", "L'assistant IA n'est pas configuré.");
  let result: AiWritingResponse; let providerStatus = "failed"; const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
    const responseFormat = input.documentCategory === "rapport" ? input.scope === "full_document" ? buildStructuredWritingResponseFormat(Object.keys(input.sections)) : buildSingleSectionWritingResponseFormat(input.scope) : OPENAI_WRITING_RESPONSE_FORMAT;
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, store: false, instructions: buildInstructions(input), input: JSON.stringify({ text: original.sanitized, context }), text: { format: responseFormat } }) }).finally(() => clearTimeout(timer));
    const provider = await response.json() as unknown;
    if (!response.ok) {
      const failure = readOpenAiFailure(response.status, provider);
      logger.error("OpenAI Responses API failure", { requestId, model, ...failure });
      const callableError = classifyOpenAiFailure(response.status);
      throw new HttpsError(callableError.code, callableError.message, failure);
    }
    const outputText = extractOpenAiResponseText(provider);
    if (!outputText) {
      logger.error("OpenAI Responses API returned no output text", { requestId, model });
      throw new HttpsError("internal", "OpenAI n'a retourné aucun texte exploitable.");
    }
    result = parseProviderResponse(JSON.parse(outputText), input, requestId);
    await incrementSchoolAiUsageAfterSuccess(usageDatabase, schoolId);
    providerStatus = "success";
    if (original.detected.length) result.warnings.unshift({ code: "sensitive_data_masked", severity: "warning", title: "Données sensibles masquées", message: "Certaines informations sensibles ont été retirées avant l'envoi.", field: input.section ?? "document" });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(error instanceof Error && error.name === "AbortError" ? "deadline-exceeded" : "unavailable", "L'assistant IA est temporairement indisponible. Votre texte n'a pas été modifié.");
  } finally {
    await db.collection("aiUsageLogs").doc(requestId).set({ schoolId, userId: auth.uid, role, documentType: input.documentType, documentId: input.documentId ?? null, section: input.section ?? null, action: input.action, createdAt: FieldValue.serverTimestamp(), status: providerStatus, provider: "openai", model, durationMs: Date.now() - startedAt, sentCharacters, receivedCharacters: typeof result! === "object" ? JSON.stringify(result!).length : 0, accepted: null }).catch((error) => logger.error("AI usage log write failed", { requestId, error }));
  }
  return result;
});

export const secretaryAiRecordDecision = onCall({ region: "europe-west1", invoker: "public" }, async (request) => {
  const db = getFirestore();
  const { auth, schoolId } = assertSecretaryAiIdentity(request.auth, request.auth?.token.schoolId);
  await prepareSchoolAiUsage(db as unknown as AiUsageDatabase, schoolId, { enforceLimit: false });
  const requestId = typeof request.data?.requestId === "string" ? request.data.requestId : "";
  const accepted = request.data?.accepted;
  if (!requestId || typeof accepted !== "boolean") throw new HttpsError("invalid-argument", "Décision invalide.");
  const reference = db.collection("aiUsageLogs").doc(requestId); const snapshot = await reference.get();
  if (!snapshot.exists || snapshot.data()?.userId !== auth.uid || snapshot.data()?.schoolId !== auth.token.schoolId) throw new HttpsError("permission-denied", "Historique inaccessible.");
  await reference.update({ accepted, decisionAt: FieldValue.serverTimestamp(), acceptedBy: auth.uid });
  return { success: true };
});
