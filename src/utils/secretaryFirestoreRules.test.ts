import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("règles Firestore Secrétaire", () => {
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  const storageRules = readFileSync(new URL("../../storage.rules", import.meta.url), "utf8");

  it("borne les fiches médicales à l'Administrateur ou au Secrétaire, à l'école, à l'année et à l'élève", () => {
    expect(rules).toContain("match /studentMedicalRecords/{studentId}");
    expect(rules).toContain('request.auth.token.role == "admin"');
    expect(rules).toContain('role() in ["school_admin", "secretary"]');
    expect(rules).toContain("medicalRecordReadInTenant(studentId)");
    expect(rules).toContain("medicalRecordStudentInYear(studentId, request.resource.data.schoolYearId)");
    expect(rules).toContain("request.resource.data.studentId == studentId");
    expect(rules).toContain("request.resource.data.createdAt is timestamp");
    expect(rules).toContain("request.resource.data.updatedAt is timestamp");
    expect(rules).toContain("sameTenantCreate()");
    expect(rules).toContain("sameYearUpdate()");
    expect(rules).toContain("allow delete: if false;");
  });

  it("autorise la suppression d'un courrier uniquement au Secrétaire de son école", () => {
    const correspondenceRules = rules.slice(rules.indexOf("match /correspondences/{correspondenceId}"), rules.indexOf("match /secretaryCounters/{counterId}"));
    expect(correspondenceRules).toContain("allow delete: if secretary() && sameTenantResource();");
    expect(correspondenceRules).not.toContain("allow delete: if true");
  });

  it("autorise les Valves au Secrétaire uniquement dans son tenant", () => {
    const valveRules = rules.slice(rules.indexOf("match /valves/{valveId}"), rules.indexOf("match /messages/{messageId}"));
    expect(valveRules).toContain('(schoolAdmin() || secretary()) && sameTenantCreate()');
    expect(valveRules).toContain('(schoolAdmin() || secretary()) && sameTenantUpdate() && sameYearUpdate()');
    expect(valveRules).toContain('(schoolAdmin() || secretary()) && sameTenantResource()');
    expect(rules).toContain('role() in ["school_admin", "cashier", "secretary"] && sameTenantCreate()');
    expect(storageRules).toContain('role() in ["school_admin", "secretary"]');
    expect(storageRules).toContain("tenantSchoolId() == schoolId");
  });
});
