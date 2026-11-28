// Lot H : 6 cartes (2 lignes de 3) sur les Dashboards des conseillers et dans le bloc « Pilotage » du Préfet d'études.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orientationPriorities, ORIENTATION_DIFFICULTY_THRESHOLD } from "./OrientationNotesContent";
import type { AdvisorResult, AdvisorStudent, OrientationNote } from "./advisorService";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const countCards = (source: string) => (source.match(/<DashboardCard(Button)? /g) ?? []).length;

describe("Lot H — cartes des Dashboards", () => {
  it("Conseiller pédagogique : 6 cartes, la 6e « Visites de classe » ouvre l'onglet Visites", () => {
    const portal = read("./PedagogicalAdvisorPortal.tsx");
    const cards = portal.match(/const cards = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
    expect((cards.match(/^\s*\[/gm) ?? []).length).toBe(5);
    expect(portal).toContain('<DashboardCardButton title="Visites de classe" value={visits.value?.visits.length ?? "—"}');
    expect(portal).toContain('onClick={() => setActiveTab("visits")}');
    expect(portal).toContain('useAdvisorData<{ visits: ClassVisit[] }>("class-visits-list", scope');
    expect(portal).toContain("grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3");
  });

  it("Conseiller d'orientation : 6 cartes, les 3 nouvelles ouvrent Élèves, Résultats et Suivi", () => {
    const portal = read("./OrientationAdvisorPortal.tsx");
    const dashboard = portal.slice(portal.indexOf('activeTab === "dashboard"'), portal.indexOf('activeTab === "students"'));
    expect(countCards(dashboard)).toBe(6);
    for (const [title, tab] of [["Élèves de mes sections", "students"], ["Élèves en difficulté", "results"], ["En difficulté, sans suivi", "notes"]]) {
      expect(dashboard).toMatch(new RegExp(`<DashboardCardButton title="${title}"[^>]*onClick=\\{\\(\\) => setActiveTab\\("${tab}"\\)\\}`));
    }
    expect(dashboard).toContain("grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3");
    expect(dashboard).not.toMatch(/amount|montant|balance|payment/i);
  });

  it("Préfet d'études : bloc Pilotage de 6 cartes, 3 par ligne sur ordinateur, 2 sur téléphone", () => {
    const section = read("../studies/PrefectDashboardSection.tsx");
    expect(countCards(section)).toBe(6);
    expect(section).toContain('<div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">');
    expect(section).not.toContain("lg:grid-cols-4");
    expect(section).toContain('title="Fiches de visite"');
    expect(section).toContain('title="Notes de suivi (orientation)"');
    expect(section).not.toMatch(/>\s*Actualiser\s*</);
    const portal = read("../studies/StudyDirectorPortal.tsx");
    expect(portal).toContain('onOpenClassVisits={() => setDrawer("class-visits")} onOpenOrientationNotes={() => setDrawer("orientation-notes")}');
    expect(portal).toContain("{isPrefectOfStudies(user) && <PrefectDashboardSection");
  });

  it("carte cliquable : même carte placée dans un bouton", () => {
    const button = read("./DashboardCardButton.tsx");
    expect(button).toContain('<button type="button" onClick={onClick}');
    expect(button).toContain("<DashboardCard ");
  });
});

describe("Lot H — calcul des priorités du Conseiller d'orientation", () => {
  const student = (id: string) => ({ id, name: id, matricule: "", className: "6ème", section: "Secondaire", gender: "", status: "ACTIVE" }) as AdvisorStudent;
  const result = (studentId: string, percentage: number | null) => ({ studentId, studentName: studentId, className: "6ème", section: "Secondaire", slot: "period_1", slotLabel: "1ère Période", percentage, rank: 1, evaluated: 3 }) as AdvisorResult;
  const note = (studentId: string) => ({ id: `n-${studentId}`, studentId, noteDate: "2026-11-20", kind: "interview", content: "x", studentName: "", className: "", section: "", authorId: "u", authorName: "" }) as OrientationNote;

  it("compte les élèves, ceux sous le seuil et ceux sans note de suivi", () => {
    expect(ORIENTATION_DIFFICULTY_THRESHOLD).toBe(50);
    const priorities = orientationPriorities(
      [student("a"), student("b"), student("c"), student("d")],
      [result("a", 32), result("b", 49.9), result("c", 50), result("d", null)],
      [note("a"), note("c")],
    );
    expect(priorities).toEqual({ students: 4, struggling: 2, strugglingWithoutNote: 1 });
  });

  it("rien n'est inventé tant qu'une liste n'est pas lue", () => {
    expect(orientationPriorities(undefined, undefined, undefined)).toEqual({ students: undefined, struggling: undefined, strugglingWithoutNote: undefined });
    expect(orientationPriorities([], [result("a", 10)], undefined)).toEqual({ students: 0, struggling: 1, strugglingWithoutNote: undefined });
    expect(orientationPriorities([], [], [])).toEqual({ students: 0, struggling: 0, strugglingWithoutNote: 0 });
  });
});
