import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const platform = readFileSync(new URL("./PlatformModule.tsx", import.meta.url), "utf8");
const loader = readFileSync(new URL("../../services/superAdminData.ts", import.meta.url), "utf8");

describe("détail école Super Administrateur", () => {
  it("expose un seul sélecteur d'année et recharge les données annuelles", () => {
    expect(platform).toContain('aria-label="Année scolaire consultée"');
    expect(platform).toContain("changeDrawerYear");
    expect(platform).toContain("getPlatformSchoolStats(drawerSchool.id, data, drawerYear?.id)");
    expect(platform).toContain("drawerYear?.id ? student.schoolYearId === drawerYear.id");
    expect(platform).toContain("log.schoolYearId === drawerYear.id");
    expect(platform).toContain("item.activeSchoolYearId === drawerYear.id");
  });

  it("filtre les collections annuelles par schoolId et schoolYearId côté loader", () => {
    expect(loader).toContain('where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)');
    expect(loader).toContain('loadSchoolYearCollection<Student>("students", schoolId, schoolYearId)');
    expect(loader).toContain('loadSchoolYearCollection<Payment>("payments", schoolId, schoolYearId)');
  });
});
