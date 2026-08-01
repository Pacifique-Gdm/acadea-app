import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("fiches médicales du menu Administrateur", () => {
  const source = readFileSync(new URL("./MenuModule.tsx", import.meta.url), "utf8");

  it("réutilise le drawer et le service médicaux partagés", () => {
    expect(source).toContain('title: "Fiches médicales"');
    expect(source).toContain("subscribeToStudentMedicalRecords");
    expect(source).toContain("<SecretaryMedicalRecordsDrawer");
  });
});
