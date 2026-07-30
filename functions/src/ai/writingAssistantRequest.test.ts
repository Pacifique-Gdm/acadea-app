import { describe, expect, it } from "vitest";
import { AI_ACTIONS, type AiWritingRequest } from "./types.js";
import { ACADEA_AI_IDENTITY, AI_ASSISTANT_VERSION, buildInstructions, parseProviderResponse, runTransformationAttempts, validateInput } from "./writingAssistant.js";
import { buildStructuredWritingResponseFormat } from "./openAiResponse.js";

const request = (action: AiWritingRequest["action"]): AiWritingRequest => ({
  schoolId: "school-1",
  academicYearId: "year-1",
  documentType: "meeting_minutes",
  documentCategory: "rapport",
  documentTypeLabel: "Rapport disciplinaire",
  documentDate: "2026-07-30",
  documentTime: "12:25",
  scope: "full_document",
  sections: { location: "Salle de réunion", subject: "Réunion pédagogique", participants: "Directeur et enseignants", discussedPoints: "Retards et résultats", decisions: "Contrôle hebdomadaire", recommendations: "Renforcer le suivi", signatures: "Directeur et secrétaire" },
  documentContext: { date: "2026-07-30", time: "12:25", endTime: "13:00", schoolName: "École test", academicYearName: "2025-2026" },
  action,
  tone: "administrative",
  length: "standard",
  additionalInstruction: "Conserver strictement les faits fournis.",
  originalText: "Faits constatés",
  consentConfirmed: true,
});

describe("requête de l'assistant rédactionnel", () => {
  it("applique l'identité officielle et le contexte scolaire Acadéa", () => {
    const instructions = buildInstructions(request("professionalize"));
    expect(ACADEA_AI_IDENTITY).toContain("assistant intelligent officiel de la plateforme Acadéa");
    for (const rule of ["gestion des établissements scolaires", "rôle Secrétaire", "rapport factuel", "procès-verbal officiel", "protocole administratif", "auto-vérification", "decisions contient des décisions administratives", "valeur ajoutée perceptible"]) expect(instructions).toContain(rule);
  });

  it("exige une instruction complémentaire exploitable", () => {
    expect(() => validateInput({ ...request("improve"), additionalInstruction: "   " })).toThrowError("L’instruction complémentaire est obligatoire");
  });
  it("reconnaît exactement les neuf identifiants partagés", () => {
    expect(AI_ACTIONS).toEqual(["reformulate", "write_complete", "correct", "improve", "develop", "formalize", "summarize", "clarify", "professionalize"]);
    for (const action of AI_ACTIONS) expect(validateInput(request(action)).action).toBe(action);
    try { validateInput({ ...request("correct"), action: "Développer le rapport disciplinaire" }); }
    catch (error) {
      expect(error).toMatchObject({ code: "invalid-argument", details: { actionReceived: "Développer le rapport disciplinaire", acceptedActions: [...AI_ACTIONS], documentCategoryReceived: "rapport", documentTypeReceived: "meeting_minutes", version: AI_ASSISTANT_VERSION } });
    }
  });

  it("donne une instruction distincte à chaque action", () => {
    const instructions = AI_ACTIONS.map((action) => buildInstructions(request(action)));
    expect(new Set(instructions).size).toBe(AI_ACTIONS.length);
  });

  it.each(AI_ACTIONS)("accepte %s en portée full_document et impose les sept clés", (action) => {
    const validated = validateInput(request(action));
    const format = buildStructuredWritingResponseFormat(Object.keys(validated.sections));
    const parsed = parseProviderResponse({ proposedText: "", scope: "full_document", sections: validated.sections, warnings: [], missingInformation: [] }, validated, `request-${action}`);
    expect(validated.scope).toBe("full_document");
    expect(format.schema.properties.sections.required).toEqual(["location", "subject", "participants", "discussedPoints", "decisions", "recommendations", "signatures"]);
    expect(format.schema.properties.sections).not.toHaveProperty("content");
    expect(parsed.sections).toEqual(validated.sections);
    expect(Object.keys(parsed.sections ?? {})).toHaveLength(7);
  });

  it("injecte la date, les heures, l'école et l'année scolaire dans le prompt", () => {
    const instructions = buildInstructions(request("develop"));
    for (const value of ["2026-07-30", "12:25", "13:00", "École test", "2025-2026", "Rapport disciplinaire"]) expect(instructions).toContain(value);
    expect(instructions).toContain("Ne déclare pas qu'elles sont manquantes lorsqu'elles existent");
  });

  it("expose la version diagnostique attendue", () => {
    expect(AI_ASSISTANT_VERSION).toBe("2026-07-30-actions-v2");
  });

  it("rejette une section inattendue ou une valeur non textuelle", () => {
    expect(() => validateInput({ ...request("correct"), sections: { ...request("correct").sections, conclusion: "Intruse" } })).toThrowError("Sections du rapport invalides.");
    expect(() => validateInput({ ...request("correct"), sections: { ...request("correct").sections, decisions: 42 } })).toThrowError("Sections du rapport invalides.");
  });

  it("ordonne de préserver la fonction métier de chaque section", () => {
    const instructions = buildInstructions(request("develop"));
    for (const instruction of ["Traite chaque section séparément", "Ne déplace jamais une information", "decisions contient uniquement les décisions prises", "recommendations contient uniquement les suites conseillées", "N'invente jamais de signataire"]) expect(instructions).toContain(instruction);
  });

  it("accepte une section canonique unique et rejette les autres clés", () => {
    const single = { ...request("clarify"), scope: "decisions", sections: { decisions: "Contrôle hebdomadaire" }, targetSection: { key: "decisions", value: "Contrôle hebdomadaire" } };
    expect(validateInput(single).sections).toEqual({ decisions: "Contrôle hebdomadaire" });
    expect(() => validateInput({ ...single, sections: { recommendations: "Hors cible" } })).toThrowError("Sections du rapport invalides.");
  });

  it("refuse une réponse OpenAI qui ne correspond pas à la portée demandée", () => {
    const input = { ...request("clarify"), scope: "decisions", sections: { decisions: "Contrôle" }, targetSection: { key: "decisions", value: "Contrôle" } };
    expect(() => parseProviderResponse({ proposedText: "", scope: "recommendations", section: { key: "recommendations", value: "Suivi" }, warnings: [], missingInformation: [] }, input, "wrong-scope")).toThrowError("ne correspond pas à la portée demandée");
  });

  it.each(["location", "subject", "participants", "discussedPoints", "decisions", "recommendations", "signatures"] as const)("isole strictement la portée %s", (scope) => {
    const base = request("improve");
    const value = base.sections[scope] ?? "";
    const validated = validateInput({ ...base, scope, sections: { [scope]: value }, targetSection: { key: scope, value }, context: { [scope]: value } });
    expect(validated.sections).toEqual({ [scope]: value });
    expect(validated.targetSection).toEqual({ key: scope, value });
  });

  it.each(["administrative", "professional", "neutral", "formal"] as const)("valide et injecte le ton %s", (tone) => {
    const validated = validateInput({ ...request("formalize"), tone });
    expect(buildInstructions(validated)).toContain(`Ton : ${tone}`);
  });

  it("rejette les anciens alias et les paramètres inconnus", () => {
    for (const patch of [{ scope: "single_section" }, { scope: "discussed_points" }, { action: "expand" }, { tone: "diplomatic" }, { length: "detailed" }]) {
      expect(() => validateInput({ ...request("improve"), ...patch })).toThrow();
    }
  });

  it("réussit au second essai lorsque la transformation devient différente", async () => {
    const input = { ...request("develop"), scope: "decisions", sections: { decisions: "Décision initiale" }, targetSection: { key: "decisions", value: "Décision initiale" } };
    const attempts: string[] = [];
    const outcome = await runTransformationAttempts(input, async (retryCount) => {
      const value = retryCount === 0 ? "Décision initiale" : "Décision administrative développée";
      attempts.push(value);
      return parseProviderResponse({ proposedText: "", scope: "decisions", section: { key: "decisions", value }, warnings: [], missingInformation: [] }, input, `retry-${retryCount}`);
    });
    expect(attempts).toHaveLength(2);
    expect(outcome.retryCount).toBe(1);
    expect(outcome.result.sections).toEqual({ decisions: "Décision administrative développée" });
  });

  it("retourne AI_NO_TRANSFORMATION après deux réponses identiques", async () => {
    const input = { ...request("correct"), scope: "decisions", sections: { decisions: "Décision initiale" }, targetSection: { key: "decisions", value: "Décision initiale" } };
    let attempts = 0;
    await expect(runTransformationAttempts(input, async (retryCount) => {
      attempts += 1;
      return parseProviderResponse({ proposedText: "", scope: "decisions", section: { key: "decisions", value: "Décision initiale" }, warnings: [], missingInformation: [] }, input, `same-${retryCount}`);
    })).rejects.toMatchObject({ code: "failed-precondition", details: { code: "AI_NO_TRANSFORMATION" } });
    expect(attempts).toBe(2);
  });

  const matrix = AI_ACTIONS.flatMap((action) => (["short", "standard", "developed"] as const).flatMap((length) => (["full_document", "decisions", "recommendations"] as const).map((scope) => ({ action, length, scope }))));
  it.each(matrix)("valide $action / $length / $scope", ({ action, length, scope }) => {
    const base = request(action);
    const candidate: AiWritingRequest = scope === "full_document"
      ? { ...base, length, scope }
      : { ...base, length, scope, sections: { [scope]: base.sections[scope] ?? "" }, targetSection: { key: scope, value: base.sections[scope] ?? "" } };
    const validated = validateInput(candidate);
    const provider = scope === "full_document"
      ? { proposedText: "", scope, sections: validated.sections, warnings: [], missingInformation: [] }
      : { proposedText: "", scope, section: validated.targetSection, warnings: [], missingInformation: [] };
    const parsed = parseProviderResponse(provider, validated, `matrix-${action}-${length}-${scope}`);
    expect(parsed.scope).toBe(scope);
    expect(Object.keys(parsed.sections ?? {})).toEqual(scope === "full_document" ? Object.keys(base.sections) : [scope]);
  });
});
