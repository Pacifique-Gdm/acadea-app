import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("règles Firestore Secrétaire", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

  it("borne les fiches médicales au Secrétaire, à l'école, à l'année et à l'élève", () => {
    expect(rules).toContain("match /studentMedicalRecords/{studentId}");
    expect(rules).toContain("request.resource.data.studentId == studentId");
    expect(rules).toContain("sameTenantCreate()");
    expect(rules).toContain("sameYearUpdate()");
    expect(rules).toContain("allow delete: if false;");
  });

  it("autorise la suppression d'un courrier uniquement au Secrétaire de son école", () => {
    const correspondenceRules = rules.slice(rules.indexOf("match /correspondences/{correspondenceId}"), rules.indexOf("match /secretaryCounters/{counterId}"));
    expect(correspondenceRules).toContain("allow delete: if secretary() && sameTenantResource();");
    expect(correspondenceRules).not.toContain("allow delete: if true");
  });
});
