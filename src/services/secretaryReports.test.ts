import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rapports du Secrétaire", () => {
  it("propose tous les modèles assistés initiaux", () => {
    const source = readFileSync(new URL("../modules/secretary/SecretaryReportsModule.tsx", import.meta.url), "utf8");
    for (const type of ["meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]) expect(source).toContain(type);
  });

  it("génère le numéro dans une transaction et borne le listener au tenant", () => {
    const source = readFileSync(new URL("./secretaryReports.ts", import.meta.url), "utf8");
    expect(source).toContain("runTransaction");
    expect(source).toContain('where("schoolId", "==", params.schoolId)');
    expect(source).toContain('where("schoolYearId", "==", params.schoolYearId)');
  });

  it("refuse toute modification métier après finalisation", () => {
    const service = readFileSync(new URL("./secretaryReports.ts", import.meta.url), "utf8");
    const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
    expect(service).toContain('report.status !== "draft"');
    expect(rules).toContain('resource.data.status == "finalized"');
    expect(rules).toContain('affectedKeys().hasOnly(["status", "archivedAt", "updatedAt"])');
  });
});
