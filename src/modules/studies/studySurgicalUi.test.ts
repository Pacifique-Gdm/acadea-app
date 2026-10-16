import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const portal = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
const calendar = readFileSync(new URL("./SchoolCalendarDrawer.tsx", import.meta.url), "utf8");
const published = readFileSync(new URL("./PublishedTimetableReadOnly.tsx", import.meta.url), "utf8");

describe("positionnement des contrôles Direction des études", () => {
  it("place Salaire/Prime immédiatement après Assistant IA dans l'ordre du DOM", () => {
    expect(portal).toMatch(/<StudyAiAssistant[^>]*\s*\/>\s*<OwnPayrollEntry[^>]*\s*\/>/);
  });
  it("garde le formulaire d'événement auprès du déclencheur et Annuler avant Ajouter", () => {
    const block = calendar.indexOf('<section className="grid gap-2 rounded border p-3">', calendar.indexOf('>Importer un calendrier scolaire</h3>'));
    const trigger = calendar.indexOf('>Ajouter un événement</button>', block);
    const form = calendar.indexOf('{editing && <div className="grid gap-2">', trigger);
    expect(block).toBeGreaterThan(0);
    expect(trigger).toBeGreaterThan(block);
    expect(form).toBeGreaterThan(trigger);
    expect(calendar.indexOf('>Annuler</button><button', form)).toBeGreaterThan(form);
    expect(calendar.slice(trigger - 110, trigger)).toContain("w-full min-w-0 justify-center");
  });
  it("efface une erreur transitoire seulement après réception des données et offre le défilement visible", () => {
    expect(published).toContain("setValue(next); setError(\"\"); setLoading(false)");
    expect(published).toContain("hasHorizontalOverflow &&");
    expect(published).toContain("scrollBy({ left: 240");
  });
});
