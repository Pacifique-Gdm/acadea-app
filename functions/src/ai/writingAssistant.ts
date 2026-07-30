import { randomUUID } from "node:crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { AI_ACTIONS, AI_LENGTHS, AI_TONES, type AiAction, type AiWritingRequest, type AiWritingResponse } from "./types.js";
import { sanitizeAiContext, sanitizeAiText } from "./sanitize.js";
import { buildSingleSectionWritingResponseFormat, buildStructuredWritingResponseFormat, classifyOpenAiFailure, extractOpenAiResponseText, isGeneratedContentIdentical, normalizeOpenAiSections, OPENAI_WRITING_RESPONSE_FORMAT, readOpenAiFailure } from "./openAiResponse.js";
import { assertSecretaryAiIdentity } from "./schoolAiAccess.js";
import { incrementSchoolAiUsageAfterSuccess, prepareSchoolAiUsage, type AiUsageDatabase } from "./schoolAiUsage.js";

const openAiApiKey = defineSecret("OPENAI_API_KEY");
export const AI_ASSISTANT_VERSION = "2026-07-30-actions-v2";
const FUNCTION_REGION = "europe-west1";
const coreActions = new Set<AiAction>(AI_ACTIONS);
const allowedScopes = new Set(["full_document", "location", "subject", "participants", "discussedPoints", "decisions", "recommendations"]);
const allowedDocuments = new Set(["outgoing_correspondence", "meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]);
export const ACADEA_AI_IDENTITY = `Tu es Acadéa AI, l'assistant intelligent officiel de la plateforme Acadéa. Tu es un expert de la gestion des établissements scolaires et tu travailles exclusivement dans le contexte d'un établissement d'enseignement. Tes propositions doivent être professionnelles, crédibles, naturelles, immédiatement utilisables et rédigées dans un français administratif clair, précis et élégant. Elles ne doivent jamais ressembler à une démonstration d'intelligence artificielle. Avant de rédiger, tiens compte du rôle Secrétaire, du module, du type de document, de la section, de la portée, de l'action, du ton, de la longueur et de l'objectif réel. Adapte le registre au document : rapport factuel, chronologique et administratif ; procès-verbal officiel, neutre et orienté vers les décisions ; courrier conforme au protocole administratif ; note administrative composée de directives claires ; incident décrit avec neutralité, précision et sans jugement personnel ; réunion pédagogique utilisant un vocabulaire éducatif et des recommandations réalistes. Effectue une auto-vérification avant de répondre : transformation réelle, portée, action, ton et longueur respectés, cohérence scolaire et aptitude à un usage officiel.`;
export const ACADEA_AI_SECTION_EXPERTISE = `Comprends la fonction administrative de chaque section. location décrit uniquement le lieu. subject produit un objet administratif clair et concis. participants conserve uniquement les participants et ne les transforme jamais en récit. discussedPoints développe uniquement les sujets réellement discutés. decisions contient des décisions administratives précises, réalistes, exécutoires et directement applicables. recommendations contient des recommandations concrètes, cohérentes et applicables. signatures ne doit jamais modifier ni inventer un signataire ou une signature. Analyse mentalement pourquoi le document existe, qui le lira, à quoi il servira, quelles informations sont essentielles et quelles formulations seraient employées par un secrétaire ou un chef d'établissement expérimenté. Apporte une valeur ajoutée perceptible par la structure, la logique, la lisibilité, la précision, la fluidité et le professionnalisme. Rédige naturellement, sans formulations mécaniques, artificielles ou répétitives.`;
export const REPORT_SECTION_FIELDS: Record<string, string[]> = {
  meeting_minutes: ["location", "subject", "participants", "discussedPoints", "decisions", "recommendations"],
  official_minutes: ["location", "subject", "participants", "agenda", "proceedings", "resolutions"],
  incident_report: ["location", "peopleConcerned", "factsDescription", "measuresTaken", "recommendations", "author"],
  activity_report: ["period", "departmentOrActivity", "objectives", "completedActivities", "results", "difficulties", "recommendations", "author"],
  administrative_note: ["number", "subject", "recipients", "effectiveDate", "content"],
  other: ["subject", "structuredSections", "author"],
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
  if (!input.scope || !allowedScopes.has(input.scope) || !input.tone || !AI_TONES.includes(input.tone) || !input.length || !AI_LENGTHS.includes(input.length) || typeof input.additionalInstruction !== "string" || !input.additionalInstruction.trim() || !input.sections || typeof input.sections !== "object" || Array.isArray(input.sections) || !input.documentContext || typeof input.documentContext !== "object" || Array.isArray(input.documentContext)) throw new HttpsError("invalid-argument", "Paramètres, portée ou contexte du document invalides. L’instruction complémentaire est obligatoire et les signatures ne sont jamais traitées par l’IA.", { acceptedScopes: [...allowedScopes], acceptedTones: AI_TONES, acceptedLengths: AI_LENGTHS, version: AI_ASSISTANT_VERSION });
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
    reformulate: "Réécris entièrement le contenu en conservant le sens, les faits et le niveau de détail. Ne te limite pas à quelques remplacements de mots.",
    summarize: "Réduis réellement le document, même lorsqu'il est bref, en supprimant les répétitions tout en conservant les faits, décisions et informations essentiels.",
  };
  const toneInstructions: Record<AiWritingRequest["tone"], string> = { administrative: "Adopte un ton administratif.", professional: "Adopte un ton professionnel.", neutral: "Adopte un ton neutre.", formal: "Adopte un ton formel." };
  const lengthInstructions: Record<AiWritingRequest["length"], string> = { short: "Produis une version courte et directe.", standard: "Produis une version équilibrée.", developed: "Produis une version détaillée, structurée et approfondie sans élargir la portée." };
  const context = input.documentContext;
  const scopeInstruction = input.documentCategory === "rapport" ? input.scope === "full_document" ? `Traite chaque section séparément et retourne les clés suivantes : ${Object.keys(input.sections).join(", ")}. Ne déplace jamais une information d'une section vers une autre. La section decisions contient uniquement les décisions prises ; recommendations contient uniquement les suites conseillées. N'invente jamais de signataire.` : `Tu modifies uniquement la section ${input.scope}. Ne réécris et ne retourne aucune autre section. N'invente jamais de signataire.` : "";
  const structuredReportInstruction = ` ${ACADEA_AI_IDENTITY} ${ACADEA_AI_SECTION_EXPERTISE} ${scopeInstruction}`;
  return `Tu es l'assistant rédactionnel administratif d'Acadéa. Écris uniquement en français correct. Tu proposes un brouillon à vérifier humainement. N'invente jamais de fait, personne, date, référence, montant, décision, sanction, vote ou signature. Préserve strictement les noms propres, dates, références, montants et numéros fournis. Ne génère jamais l'en-tête, la référence automatique, le statut, le signataire, la signature, le cachet ou les données d'envoi. La proposition doit refléter clairement l'action demandée. Ne recopie jamais simplement le texte source : une réponse identique est invalide pour toutes les actions, y compris la correction. Portée : ${input.scope}. Action : ${input.action}. Ton : ${input.tone}. Longueur : ${input.length}. Instruction complémentaire : ${input.additionalInstruction}. ${actionInstructions[input.action]} ${toneInstructions[input.tone]} ${lengthInstructions[input.length]}${structuredReportInstruction} Informations du document : catégorie=${input.documentCategory}; type=${input.documentTypeLabel}; date=${context.date || input.documentDate || "non fournie"}; heure=${context.time || input.documentTime || "non fournie"}; heure de fin=${context.endTime || "non fournie"}; établissement=${context.schoolName || input.schoolId}; année scolaire=${context.academicYearName || input.academicYearId || "non fournie"}. Utilise les date et heure fournies. Ne déclare pas qu'elles sont manquantes lorsqu'elles existent. Ne les invente pas lorsqu'elles sont absentes.`;
}

export function parseProviderResponse(value: unknown, input: AiWritingRequest, requestId: string): AiWritingResponse {
  if (!value || typeof value !== "object") throw new HttpsError("internal", "Réponse IA invalide.");
  const data = value as Record<string, unknown>;
  if (input.documentCategory === "rapport" && data.scope !== input.scope) throw new HttpsError("internal", "La réponse de l’Assistant IA ne correspond pas à la portée demandée.", { code: "INVALID_AI_RESPONSE" });
  const providerSection = data.section && typeof data.section === "object" ? data.section as { key?: unknown; value?: unknown } : undefined;
  const section = typeof providerSection?.key === "string" && typeof providerSection.value === "string" && providerSection.key === input.scope ? { key: providerSection.key, value: providerSection.value } : undefined;
  const sections = input.scope === "full_document" ? normalizeOpenAiSections(data.sections) : section ? { [section.key]: section.value } : {};
  const warnings = Array.isArray(data.warnings) ? data.warnings.filter((item) => item && typeof item === "object" && typeof (item as { message?: unknown }).message === "string") : [];
  const missingInformation = Array.isArray(data.missingInformation) ? data.missingInformation.filter((item) => item && typeof item === "object" && typeof (item as { field?: unknown }).field === "string") : [];
  const proposedText = typeof data.proposedText === "string" ? data.proposedText.trim() : "";
  if (!proposedText && Object.keys(sections).length === 0) throw new HttpsError("internal", "La réponse de l’Assistant IA ne contient pas de proposition exploitable.", { code: "INVALID_AI_RESPONSE" });
  return { success: true, action: input.action, scope: input.scope, originalText: input.originalText ?? "", proposedText, ...(section ? { section } : {}), sections, warnings: warnings as AiWritingResponse["warnings"], missingInformation: missingInformation as AiWritingResponse["missingInformation"], metadata: { requestId, generatedAt: new Date().toISOString(), version: AI_ASSISTANT_VERSION, backendVersion: process.env.K_REVISION ?? process.env.GIT_SHA ?? AI_ASSISTANT_VERSION } };
}

export async function runTransformationAttempts(input: AiWritingRequest, attempt: (retryCount: number) => Promise<AiWritingResponse>) {
  for (let retryCount = 0; retryCount < 2; retryCount += 1) {
    const result = await attempt(retryCount);
    const generated = result.sections ?? (result.proposedText ? { document: result.proposedText } : {});
    const source = result.sections ? input.sections : { document: input.originalText ?? "" };
    if (!isGeneratedContentIdentical(source, generated)) return { result, retryCount };
  }
  throw new HttpsError("failed-precondition", "L’Assistant IA n’a pas produit de transformation exploitable.", { code: "AI_NO_TRANSFORMATION" });
}

export const secretaryAiWritingAssistant = onCall({ region: FUNCTION_REGION, timeoutSeconds: 60, memory: "256MiB", secrets: [openAiApiKey], invoker: "public" }, async (request) => {
  const startedAt = Date.now(); const requestId = randomUUID();
  const rawInput = request.data && typeof request.data === "object" ? request.data as Partial<AiWritingRequest> : {};
  const projectId = firebaseProjectId();
  if (diagnosticLoggingEnabled(projectId)) logger.info("Secretary AI request diagnostic", { version: AI_ASSISTANT_VERSION, action: rawInput.action ?? null, scope: rawInput.scope ?? null, documentCategory: rawInput.documentCategory ?? null, documentType: rawInput.documentType ?? null, documentTypeLabel: rawInput.documentTypeLabel ?? null, sectionKeysReceived: rawInput.sections && typeof rawInput.sections === "object" ? Object.keys(rawInput.sections) : [], projectId, region: FUNCTION_REGION });
  const input = validateInput(request.data);
  if (diagnosticLoggingEnabled(projectId)) logger.info("Secretary AI validated request", { event: "secretary_ai_backend_request", action: input.action, scope: input.scope, tone: input.tone, length: input.length, targetSectionKey: input.targetSection?.key ?? null, sourceLength: Object.values(input.sections).join("").length, sectionKeysReceived: Object.keys(input.sections) });
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
  let result: AiWritingResponse | undefined; let providerStatus = "failed"; const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  try {
    const responseFormat = input.documentCategory === "rapport" ? input.scope === "full_document" ? buildStructuredWritingResponseFormat(Object.keys(input.sections)) : buildSingleSectionWritingResponseFormat(input.scope) : OPENAI_WRITING_RESPONSE_FORMAT;
    const transformation = await runTransformationAttempts({ ...input, originalText: original.sanitized }, async (retryCount) => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
      const retryInstruction = retryCount === 1 ? " La première réponse était identique à la source. Produis cette fois une transformation réelle et visible, sans inventer de faits." : "";
      const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, store: false, instructions: `${buildInstructions(input)}${retryInstruction}`, input: JSON.stringify({ text: original.sanitized, context }), text: { format: responseFormat } }) }).finally(() => clearTimeout(timer));
      const provider = await response.json() as unknown;
      if (!response.ok) {
        const failure = readOpenAiFailure(response.status, provider);
        logger.error("OpenAI Responses API failure", { requestId, model, ...failure });
        const callableError = classifyOpenAiFailure(response.status);
        throw new HttpsError(callableError.code, callableError.message, failure);
      }
      const outputText = extractOpenAiResponseText(provider);
      if (!outputText) throw new HttpsError("internal", "La réponse de l’Assistant IA ne contient pas de proposition exploitable.", { code: "INVALID_AI_RESPONSE" });
      try { result = parseProviderResponse(JSON.parse(outputText), input, requestId); }
      catch (error) { if (error instanceof HttpsError) throw error; throw new HttpsError("internal", "La réponse de l’Assistant IA ne contient pas de proposition exploitable.", { code: "INVALID_AI_RESPONSE" }); }
      const generated = result.sections ?? (result.proposedText ? { document: result.proposedText } : {});
      const source = result.sections ? input.sections : { document: input.originalText ?? "" };
      const identical = isGeneratedContentIdentical(source, generated);
      if (diagnosticLoggingEnabled(projectId)) logger.info("Secretary AI OpenAI response", { event: "secretary_ai_openai_response", generatedLength: Object.values(generated).join("").length, isIdenticalToSource: identical, retryCount, durationMs: Date.now() - startedAt });
      return result;
    });
    result = transformation.result;
    if (!result) throw new HttpsError("internal", "La réponse de l’Assistant IA ne contient pas de proposition exploitable.", { code: "INVALID_AI_RESPONSE" });
    await incrementSchoolAiUsageAfterSuccess(usageDatabase, schoolId);
    providerStatus = "success";
    if (original.detected.length) result.warnings.unshift({ code: "sensitive_data_masked", severity: "warning", title: "Données sensibles masquées", message: "Certaines informations sensibles ont été retirées avant l'envoi.", field: input.section ?? "document" });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(error instanceof Error && error.name === "AbortError" ? "deadline-exceeded" : "unavailable", "L'assistant IA est temporairement indisponible. Votre texte n'a pas été modifié.");
  } finally {
    await db.collection("aiUsageLogs").doc(requestId).set({ schoolId, userId: auth.uid, role, documentType: input.documentType, documentId: input.documentId ?? null, section: input.section ?? null, action: input.action, createdAt: FieldValue.serverTimestamp(), status: providerStatus, provider: "openai", model, durationMs: Date.now() - startedAt, sentCharacters, receivedCharacters: typeof result! === "object" ? JSON.stringify(result!).length : 0, accepted: null }).catch((error) => logger.error("AI usage log write failed", { requestId, error }));
  }
  if (!result) throw new HttpsError("internal", "La réponse de l’Assistant IA ne contient pas de proposition exploitable.", { code: "INVALID_AI_RESPONSE" });
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
