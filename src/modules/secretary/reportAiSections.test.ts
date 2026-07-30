import { describe, expect, it } from "vitest";
import { applyReportAiSections, buildReportAiSections, editedReportSectionsToApply, getTargetSections, REPORT_AI_SECTION_DEFINITIONS } from "./reportAiSections";

const fields = ["lieu", "objet", "participants", "points abordés", "décisions", "recommandations", "signatures"];

describe("sections IA d'un rapport", () => {
  it("envoie séparément les sept champs réels, y compris les champs vides", () => {
    expect(REPORT_AI_SECTION_DEFINITIONS.meeting_minutes.map(({ formField }) => formField)).toEqual(fields);
    expect(buildReportAiSections("meeting_minutes", { lieu: "Salle", décisions: "Contrôle" })).toEqual({ location: "Salle", subject: "", participants: "", discussedPoints: "", decisions: "Contrôle", recommendations: "", signatures: "" });
  });

  it("applique chaque valeur modifiée à sa section sans concaténation", () => {
    const current = buildReportAiSections("meeting_minutes", Object.fromEntries(fields.map((field) => [field, `ancien-${field}`])));
    const edited = Object.fromEntries(Object.keys(current).map((field) => [field, `nouveau-${field}`]));
    expect(editedReportSectionsToApply("full_document", current, edited)).toEqual(edited);
    expect(editedReportSectionsToApply("decisions", current, { decisions: "Décision corrigée", recommendations: "Ne pas appliquer" })).toEqual({ decisions: "Décision corrigée" });
    expect(getTargetSections("recommendations", current)).toEqual({ recommendations: current.recommendations });
  });

  it("préserve la valeur courante lorsqu'une proposition structurée manque", () => {
    expect(editedReportSectionsToApply("full_document", { location: "Salle", signatures: "Directeur" }, { location: "Nouvelle salle" })).toEqual({ location: "Nouvelle salle", signatures: "Directeur" });
  });

  it("remplace atomiquement les sept champs contrôlés sans toucher aux métadonnées", () => {
    const report = { date: "2026-07-30", startTime: "12:25", endTime: "13:00", type: "meeting_minutes", content: Object.fromEntries(fields.map((field) => [field, `ancien-${field}`])) };
    const generated = { location: "Salle B", subject: "Objet B", participants: "Participants B", discussedPoints: "Points B", decisions: "Décisions B", recommendations: "Recommandations B", signatures: "Signatures B" };
    const updated = { ...report, content: applyReportAiSections("meeting_minutes", report.content, generated) };
    expect(updated.content).toEqual({ lieu: "Salle B", objet: "Objet B", participants: "Participants B", "points abordés": "Points B", décisions: "Décisions B", recommandations: "Recommandations B", signatures: "Signatures B" });
    expect({ date: updated.date, startTime: updated.startTime, endTime: updated.endTime, type: updated.type }).toEqual({ date: report.date, startTime: report.startTime, endTime: report.endTime, type: report.type });
  });
});
