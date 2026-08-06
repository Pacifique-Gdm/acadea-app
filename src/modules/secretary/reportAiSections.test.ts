import { describe, expect, it } from "vitest";
import { applyReportAiSections, buildReportAiSections, editedReportSectionsToApply, getTargetSections, MEETING_MINUTES_SECTION_ORDER, REPORT_AI_SECTION_DEFINITIONS, resolveGeneratedScope, validateAiSectionsForScope } from "./reportAiSections";

const fields = ["lieu", "objet", "participants", "points abordés", "décisions", "recommandations"];

describe("sections IA d'un rapport", () => {
  it("partage l'ordre officiel du formulaire tout en excluant Signatures de l'IA", () => {
    expect(MEETING_MINUTES_SECTION_ORDER).toEqual(["lieu", "objet", "participants", "points abordés", "décisions", "recommandations", "signatures"]);
    expect(REPORT_AI_SECTION_DEFINITIONS.meeting_minutes.map(({ formField }) => formField)).toEqual(MEETING_MINUTES_SECTION_ORDER.slice(0, -1));
  });
  it("envoie séparément les six champs rédactionnels, sans les signatures", () => {
    expect(REPORT_AI_SECTION_DEFINITIONS.meeting_minutes.map(({ formField }) => formField)).toEqual(fields);
    expect(buildReportAiSections("meeting_minutes", { lieu: "Salle", décisions: "Contrôle", signatures: "Directeur" })).toEqual({ location: "Salle", subject: "", participants: "", discussedPoints: "", decisions: "Contrôle", recommendations: "" });
  });

  it("applique chaque valeur modifiée à sa section sans concaténation", () => {
    const current = buildReportAiSections("meeting_minutes", Object.fromEntries(fields.map((field) => [field, `ancien-${field}`])));
    const edited = Object.fromEntries(Object.keys(current).map((field) => [field, `nouveau-${field}`]));
    expect(editedReportSectionsToApply("full_document", current, edited)).toEqual(edited);
    expect(editedReportSectionsToApply("decisions", current, { decisions: "Décision corrigée", recommendations: "Ne pas appliquer" })).toEqual({ decisions: "Décision corrigée" });
    expect(getTargetSections("recommendations", current)).toEqual({ recommendations: current.recommendations });
  });

  it("affiche et applique prioritairement la portée réellement générée", () => {
    expect(resolveGeneratedScope("decisions", "recommendations", "location")).toBe("decisions");
    expect(resolveGeneratedScope(undefined, "recommendations", "location")).toBe("recommendations");
    expect(editedReportSectionsToApply(resolveGeneratedScope("decisions", "recommendations", "location"), { location: "Salle", decisions: "Avant", recommendations: "Avant" }, { decisions: "Après", recommendations: "Ignorer" })).toEqual({ decisions: "Après" });
  });

  it("préserve la valeur courante lorsqu'une proposition structurée manque", () => {
    expect(editedReportSectionsToApply("full_document", { location: "Salle" }, { location: "Nouvelle salle" })).toEqual({ location: "Nouvelle salle" });
  });

  it("remplace atomiquement les six champs contrôlés sans toucher aux métadonnées", () => {
    const report = { date: "2026-07-30", startTime: "12:25", endTime: "13:00", type: "meeting_minutes", content: Object.fromEntries(fields.map((field) => [field, `ancien-${field}`])) };
    const generated = { location: "Salle B", subject: "Objet B", participants: "Participants B", discussedPoints: "Points B", decisions: "Décisions B", recommendations: "Recommandations B" };
    const updated = { ...report, content: applyReportAiSections("meeting_minutes", report.content, generated) };
    expect(updated.content).toEqual({ lieu: "Salle B", objet: "Objet B", participants: "Participants B", "points abordés": "Points B", décisions: "Décisions B", recommandations: "Recommandations B" });
    expect({ date: updated.date, startTime: updated.startTime, endTime: updated.endTime, type: updated.type }).toEqual({ date: report.date, startTime: report.startTime, endTime: report.endTime, type: report.type });
  });

  it("rejette les sections manquantes, inconnues, vides ou composées de ponctuation", () => {
    expect(validateAiSectionsForScope("decisions", { decisions: "Avant" }, { recommendations: "Suivi" })).toBe(false);
    expect(validateAiSectionsForScope("decisions", { decisions: "Avant" }, { decisions: ";" })).toBe(false);
    expect(validateAiSectionsForScope("full_document", { location: "Salle" }, { location: "Salle B", unknown: "Valeur" })).toBe(false);
    expect(validateAiSectionsForScope("decisions", { decisions: "Avant" }, { decisions: "Décision applicable" })).toBe(true);
  });
});
