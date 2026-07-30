import type { SecretaryReportType } from "./secretaryTypes";

export interface ReportAiSectionDefinition { key: string; formField: string; label: string }

export const REPORT_AI_SECTION_DEFINITIONS: Record<SecretaryReportType, ReportAiSectionDefinition[]> = {
  meeting_minutes: [
    { key: "location", formField: "lieu", label: "lieu" },
    { key: "subject", formField: "objet", label: "objet" },
    { key: "participants", formField: "participants", label: "participants" },
    { key: "discussedPoints", formField: "points abordés", label: "points abordés" },
    { key: "decisions", formField: "décisions", label: "décisions" },
    { key: "recommendations", formField: "recommandations", label: "recommandations" },
    { key: "signatures", formField: "signatures", label: "signatures" },
  ],
  official_minutes: [
    { key: "location", formField: "lieu", label: "lieu" }, { key: "subject", formField: "objet", label: "objet" }, { key: "participants", formField: "participants", label: "participants" }, { key: "agenda", formField: "ordre du jour", label: "ordre du jour" }, { key: "proceedings", formField: "déroulement", label: "déroulement" }, { key: "resolutions", formField: "résolutions", label: "résolutions" }, { key: "signatures", formField: "signatures", label: "signatures" },
  ],
  incident_report: [
    { key: "location", formField: "lieu", label: "lieu" }, { key: "peopleConcerned", formField: "personnes concernées", label: "personnes concernées" }, { key: "factsDescription", formField: "description des faits", label: "description des faits" }, { key: "measuresTaken", formField: "mesures prises", label: "mesures prises" }, { key: "recommendations", formField: "recommandations", label: "recommandations" }, { key: "author", formField: "auteur", label: "auteur" },
  ],
  activity_report: [
    { key: "period", formField: "période", label: "période" }, { key: "departmentOrActivity", formField: "service ou activité", label: "service ou activité" }, { key: "objectives", formField: "objectifs", label: "objectifs" }, { key: "completedActivities", formField: "activités réalisées", label: "activités réalisées" }, { key: "results", formField: "résultats", label: "résultats" }, { key: "difficulties", formField: "difficultés", label: "difficultés" }, { key: "recommendations", formField: "recommandations", label: "recommandations" }, { key: "author", formField: "auteur", label: "auteur" },
  ],
  administrative_note: [
    { key: "number", formField: "numéro", label: "numéro" }, { key: "subject", formField: "objet", label: "objet" }, { key: "recipients", formField: "destinataires", label: "destinataires" }, { key: "effectiveDate", formField: "date d'application", label: "date d'application" }, { key: "content", formField: "contenu", label: "contenu" }, { key: "signer", formField: "signataire", label: "signataire" },
  ],
  other: [
    { key: "subject", formField: "objet", label: "objet" }, { key: "structuredSections", formField: "sections structurées", label: "sections structurées" }, { key: "author", formField: "auteur", label: "auteur" }, { key: "signatures", formField: "signatures", label: "signatures" },
  ],
};

export function buildReportAiSections(type: SecretaryReportType, content: Record<string, string>) {
  return Object.fromEntries(REPORT_AI_SECTION_DEFINITIONS[type].map(({ key, formField }) => [key, content[formField] ?? ""]));
}

export function reportAiSectionLabels(type: SecretaryReportType) {
  return Object.fromEntries(REPORT_AI_SECTION_DEFINITIONS[type].map(({ key, label }) => [key, label]));
}

export function applyReportAiSections(type: SecretaryReportType, current: Record<string, string>, generated: Record<string, string>) {
  const next = { ...current };
  REPORT_AI_SECTION_DEFINITIONS[type].forEach(({ key, formField }) => { if (key in generated) next[formField] = generated[key]; });
  return next;
}

export function getTargetSections(scope: string, sections: Record<string, string>) {
  if (scope === "full_document") return { ...sections };
  return scope in sections ? { [scope]: sections[scope] ?? "" } : {};
}

export function editedReportSectionsToApply(scope: string, current: Record<string, string>, edited: Record<string, string>) {
  const keys = scope === "full_document" ? Object.keys(current) : [scope];
  return Object.fromEntries(keys.filter((key) => key in current).map((key) => [key, edited[key] ?? current[key] ?? ""]));
}
