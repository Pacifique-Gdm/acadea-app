import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tableaux Courrier et Rapports du Secrétaire", () => {
  const viewSource = readFileSync(new URL("./SecretaryViewActionButton.tsx", import.meta.url), "utf8");
  it.each([
    ["Courrier", "./SecretaryCorrespondenceModule.tsx"],
    ["Rapports", "./SecretaryReportsModule.tsx"],
  ])("remplace l'archivage par la suppression et préserve les archives de %s", (_label, file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("SecretaryViewActionButton");
    expect(source.includes('label="Supprimer"') || source.includes('title="Supprimer"')).toBe(true);
    expect(source).toContain("Afficher le PDF");
    expect(source).not.toContain('title="Archiver"');
    expect(source).not.toContain('label="Archiver"');
    expect(source).toContain("Restaurer");
    if (_label === "Rapports") expect(source).toContain("Archives");
    else expect(source).toContain('item.status === "archived"');
    expect(source).not.toContain("<th className=\"py-2\">Statut</th>");
    expect(source).not.toContain('value={statusFilter}');
  });
  it("partage exactement le bouton Voir sans texte visible", () => {
    expect(viewSource).toContain('title="Voir" aria-label="Voir"');
    expect(viewSource).toContain('<Eye aria-hidden="true"');
    expect(viewSource).not.toContain(">Voir</button>");
  });
});
