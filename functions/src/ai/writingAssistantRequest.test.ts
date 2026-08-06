import { describe, expect, it } from "vitest";
import { AI_ACTIONS, type AiWritingRequest } from "./types.js";
import { AI_ASSISTANT_VERSION, buildInstructions, parseProviderResponse, runTransformationAttempts, validateInput } from "./writingAssistant.js";

const sections: Record<string, string> = { location: "Salle de réunion", subject: "Réunion pédagogique", participants: "Directeur et enseignants", discussedPoints: "Retards et résultats", decisions: "Contrôle hebdomadaire", recommendations: "Renforcer le suivi" };
const request = (action: AiWritingRequest["action"], scope = "full_document"): AiWritingRequest => ({
  schoolId: "school-1", academicYearId: "year-1", documentType: "meeting_minutes", documentCategory: "rapport", documentTypeLabel: "Compte rendu", documentDate: "2026-07-30", documentTime: "12:25", scope,
  sections: scope === "full_document" ? sections : { [scope]: sections[scope] ?? "" },
  ...(scope === "full_document" ? {} : { targetSection: { key: scope, value: sections[scope] ?? "" } }),
  documentContext: { date: "2026-07-30", time: "12:25", endTime: "13:00", schoolName: "École test", academicYearName: "2025-2026" },
  action, tone: "administrative", length: "standard", additionalInstruction: "Conserver strictement les faits fournis.", originalText: "Faits constatés", consentConfirmed: true,
});

describe("requête simplifiée de l'assistant rédactionnel", () => {
  it("accepte uniquement Reformuler et Résumer", () => {
    expect(AI_ACTIONS).toEqual(["reformulate", "summarize"]);
    for (const action of AI_ACTIONS) expect(validateInput(request(action)).action).toBe(action);
    for (const action of ["write_complete", "correct", "improve", "develop", "formalize", "clarify", "professionalize"]) {
      expect(() => validateInput({ ...request("reformulate"), action })).toThrowError("Action ou document non pris en charge");
    }
  });

  it.each(["reformulate", "summarize"] as const)("intègre l'instruction complémentaire pour %s + Décisions", (action) => {
    const instructions = buildInstructions(request(action, "decisions"));
    expect(instructions).toContain("Instruction complémentaire : Conserver strictement les faits fournis.");
    expect(instructions).toContain("retourne exactement les sections suivantes, dans cet ordre : decisions");
  });

  it("isole toutes les portées autorisées et refuse Signatures", () => {
    for (const scope of ["location", "subject", "participants", "discussedPoints", "decisions", "recommendations"]) {
      const validated = validateInput(request("reformulate", scope));
      expect(Object.keys(validated.sections)).toEqual([scope]);
    }
    expect(() => validateInput({ ...request("reformulate", "decisions"), scope: "signatures", sections: { signatures: "Direction" }, targetSection: { key: "signatures", value: "Direction" } })).toThrowError("signatures ne sont jamais traitées par l’IA");
  });

  it("ne demande que les six sections rédactionnelles du compte rendu", () => {
    const validated = validateInput(request("summarize"));
    const parsed = parseProviderResponse({ proposedText: "", scope: "full_document", sections: validated.sections, warnings: [], missingInformation: [] }, validated, "request");
    expect(Object.keys(parsed.sections ?? {})).toEqual(Object.keys(sections));
    expect(parsed.sections).not.toHaveProperty("signatures");
  });

  it("accepte une portée multi-sélection canonique et rejette toute réponse partielle ou supplémentaire", () => {
    const input = validateInput({ ...request("reformulate"), scope: { mode: "selected_sections", sections: ["subject", "decisions"] }, sections: { subject: sections.subject, decisions: sections.decisions } });
    expect(input.scope).toEqual({ mode: "selected_sections", sections: ["subject", "decisions"] });
    expect(parseProviderResponse({ proposedText: "", scope: "selected_sections", sections: { subject: "Objet formalisé", decisions: "Décision applicable" }, warnings: [], missingInformation: [] }, input, "multi").sections).toEqual({ subject: "Objet formalisé", decisions: "Décision applicable" });
    expect(() => parseProviderResponse({ proposedText: "", scope: "selected_sections", sections: { subject: "Objet formalisé" }, warnings: [], missingInformation: [] }, input, "partial")).toThrowError("incomplète");
    expect(() => parseProviderResponse({ proposedText: "", scope: "selected_sections", sections: { subject: "Objet", decisions: "Décision", location: "Salle" }, warnings: [], missingInformation: [] }, input, "extra")).toThrowError("incomplète");
  });

  it("effectue une seconde tentative puis retourne AI_NO_TRANSFORMATION", async () => {
    const input = request("reformulate", "decisions");
    let attempts = 0;
    await expect(runTransformationAttempts(input, async (retryCount) => {
      attempts += 1;
      return parseProviderResponse({ proposedText: "", scope: "selected_sections", sections: { decisions: "Contrôle hebdomadaire" }, warnings: [], missingInformation: [] }, input, `same-${retryCount}`);
    })).rejects.toMatchObject({ code: "failed-precondition", details: { code: "AI_NO_TRANSFORMATION" } });
    expect(attempts).toBe(2);
  });

  it("accepte une véritable transformation au second essai", async () => {
    const input = request("summarize", "decisions");
    const outcome = await runTransformationAttempts(input, async (retryCount) => parseProviderResponse({ proposedText: "", scope: "selected_sections", sections: { decisions: retryCount ? "Contrôle chaque semaine" : "Contrôle hebdomadaire" }, warnings: [], missingInformation: [] }, input, `retry-${retryCount}`));
    expect(outcome.retryCount).toBe(1);
    expect(outcome.result.sections).toEqual({ decisions: "Contrôle chaque semaine" });
  });

  it("conserve les validations de contexte et la version diagnostique", () => {
    expect(() => validateInput({ ...request("summarize"), additionalInstruction: " " })).toThrowError("instruction complémentaire est obligatoire");
    expect(buildInstructions(request("reformulate"))).toContain("2026-07-30");
    expect(AI_ASSISTANT_VERSION).toBe("2026-07-30-actions-v2");
  });
});
