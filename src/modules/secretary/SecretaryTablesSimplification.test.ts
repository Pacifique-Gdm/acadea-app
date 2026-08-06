import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tableaux Courrier et Rapports du Secrétaire", () => {
  it.each([
    ["Courrier", "./SecretaryCorrespondenceModule.tsx"],
    ["Rapports", "./SecretaryReportsModule.tsx"],
  ])("limite les actions de %s à Voir et Supprimer définitivement", (_label, file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("Voir");
    expect(source).toContain("Supprimer définitivement");
    expect(source).not.toContain("<th className=\"py-2\">Statut</th>");
    expect(source).not.toContain('value={statusFilter}');
  });
});
