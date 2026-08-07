import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("rapports du Secrétaire", () => {
  it("propose tous les modèles assistés initiaux", () => {
    const source = readFileSync(new URL("../modules/secretary/SecretaryReportsModule.tsx", import.meta.url), "utf8");
    for (const type of ["meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]) expect(source).toContain(type);
  });

  it("génère un numéro unique depuis l'identifiant Firestore et borne le listener au tenant", () => {
    const source = readFileSync(new URL("./secretaryReports.ts", import.meta.url), "utf8");
    expect(source).not.toContain("runTransaction");
    expect(source).toContain("await setDoc(reportRef");
    expect(source).toContain("reportRef.id.slice(0, 8)");
    expect(source).toContain('where("schoolId", "==", params.schoolId)');
    expect(source).toContain('where("schoolYearId", "==", params.schoolYearId)');
  });

  it("enregistre les heures dans les créations et modifications", () => {
    const source = readFileSync(new URL("./secretaryReports.ts", import.meta.url), "utf8");
    expect(source).toContain("startTime: params.startTime");
    expect(source).toContain("endTime: params.endTime");
    expect(source).toContain('"startTime" | "endTime"');
  });

  it("refuse toute modification métier après finalisation", () => {
    const service = readFileSync(new URL("./secretaryReports.ts", import.meta.url), "utf8");
    const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
    expect(service).toContain('report.status !== "draft"');
    expect(rules).toContain('resource.data.status == "finalized"');
    expect(service).toContain('action: "archive" | "restore" | "delete"');
    expect(rules).not.toContain('affectedKeys().hasOnly(["status", "archivedAt", "updatedAt"])');
  });
});
