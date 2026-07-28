import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("formulaire Nouveau rapport", () => {
  const source = readFileSync(new URL("./SecretaryReportsModule.tsx", import.meta.url), "utf8");

  it("laisse le Select actif pour une nouvelle création et expose tous les types", () => {
    expect(source).toContain('const readOnly = Boolean(selected && selected.status !== "draft")');
    expect(source).toContain('aria-label="Type de rapport"');
    for (const type of ["meeting_minutes", "activity_report", "incident_report", "official_minutes", "administrative_note", "other"]) expect(source).toContain(type);
    expect(source).toContain("setType(event.target.value as SecretaryReportType)");
  });

  it("enregistre et réinitialise Heure de début et Heure de fin", () => {
    expect(source).toContain("Heure de début");
    expect(source).toContain("Heure de fin");
    expect(source).toContain('type="time"');
    expect(source).toContain("startTime, endTime");
    expect(source).toContain('setStartTime("")');
    expect(source).toContain('setEndTime("")');
  });

  it("refuse une heure de fin antérieure et affiche l'erreur dans le formulaire", () => {
    expect(source).toContain("if (endTime < startTime)");
    expect(source).toContain("L'heure de fin doit être postérieure ou égale à l'heure de début.");
    expect(source).toContain("{formError &&");
  });

  it("génère, désactive pendant le traitement et ferme uniquement après succès", () => {
    expect(source).toContain('busy ? "Génération…" : "Générer le rapport"');
    expect(source).toContain("disabled={busy}");
    const createIndex = source.indexOf("await createSecretaryReport");
    expect(createIndex).toBeGreaterThan(-1);
    expect(source.indexOf("setOpen(false)", createIndex)).toBeGreaterThan(createIndex);
    expect(source).toContain("Rapport généré et enregistré en brouillon.");
    expect(source).toContain("console.error(\"Échec de la génération du rapport\"");
  });
});
