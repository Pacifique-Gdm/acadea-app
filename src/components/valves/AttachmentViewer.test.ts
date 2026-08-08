import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AttachmentViewer.tsx", import.meta.url), "utf8");

describe("visualiseur sécurisé des pièces jointes Valves", () => {
  it("classe la référence avant tout rendu ou téléchargement", () => {
    expect(source).toContain("classifyValveAttachmentReference");
    expect(source).toContain('referenceKind === "blocked"');
    expect(source).toContain('referenceKind === "external_legacy"');
    expect(source).toContain("trustedPreview");
  });

  it("ouvre les anciens liens externes dans un contexte isolé", () => {
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain("Lien externe historique");
  });

  it("ne rend plus les contenus texte ou HTML actifs", () => {
    expect(source).not.toContain("response.text()");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });
});
