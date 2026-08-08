import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SEC-018 — runbook de réponse aux incidents", () => {
  const runbook = readFileSync("docs/security/incident-response.md", "utf8");
  const retention = readFileSync("docs/security/temporary-artifacts.md", "utf8");
  const migration = readFileSync("docs/security/public-app-config-migration.md", "utf8");

  it("documente les scénarios, le confinement et les révocations", () => {
    for (const expected of ["Compte utilisateur compromis", "Compte Super Administrateur compromis", "Compte de service Firebase divulgué", "Clé OpenAI divulguée", "Abus financier", "Upload malveillant", "revokeRefreshTokens"]) {
      expect(runbook).toContain(expected);
    }
  });

  it("documente sauvegarde, restauration, Storage et exercice non destructif", () => {
    for (const expected of ["gcloud firestore export", "gcloud firestore import", "Storage", "Exercice non destructif trimestriel", "projet de test isolé"]) {
      expect(runbook).toContain(expected);
    }
  });

  it("distingue les recommandations des mécanismes confirmés", () => {
    expect(runbook).toContain("Non confirmée par le dépôt");
    expect(runbook).toContain("Ces valeurs sont des recommandations, pas des engagements actuels");
    expect(runbook).toContain("Les 15 premières minutes");
    expect(runbook).toContain("Monitoring recommandé");
  });

  it("formalise la rétention et la migration publique sans action distante", () => {
    expect(retention).toContain("au plus tard après 7 jours");
    expect(retention).toContain("Aucun compte de service");
    expect(migration).toContain("publicConfig/appConfig");
    expect(migration).toContain("n'a pas été exécutée");
  });
});
