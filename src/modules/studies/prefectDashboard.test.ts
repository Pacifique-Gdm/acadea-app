import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/auth", () => ({ getCurrentFirebaseIdToken: async () => "jeton" }));
vi.mock("../../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { cachedPrefectDashboard, clearPrefectDashboardCache, isPrefectOfStudies, loadPrefectDashboard, prefectDashboardNeedsLoad } from "./prefectDashboard";

const payload = { sections: ["Primaire"], today: "2026-11-26", enrollment: { students: 3, classes: 1 }, presence: { recorded: 3, present: 2, absent: 1, rate: 67 },
  difficulty: { slot: "period_1", slotLabel: "1ère Période", threshold: 50, evaluated: 3, count: 2 }, approvedAbsences: { count: 0, items: [] } };
const fetcher = () => vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("lot P1 : tableau de pilotage du Préfet d'études (écran)", () => {
  beforeEach(() => clearPrefectDashboardCache());

  it("seule la fonction « Préfet d'études » voit les ajouts", () => {
    expect(isPrefectOfStudies({ role: "study_director", studyFunction: "prefect_of_studies" })).toBe(true);
    expect(isPrefectOfStudies({ role: "study_director" })).toBe(false);
    expect(isPrefectOfStudies({ role: "study_director", studyFunction: "director_of_studies" })).toBe(false);
    expect(isPrefectOfStudies({ role: "teacher", studyFunction: "prefect_of_studies" })).toBe(false);
  });

  it("réouverture : données gardées en mémoire, aucun nouvel appel ; relecture forcée = un seul appel", async () => {
    const fetchMock = fetcher();
    await loadPrefectDashboard("u1", "school-a", "year-1", { today: "2026-11-26", fetcher: fetchMock });
    await loadPrefectDashboard("u1", "school-a", "year-1", { today: "2026-11-26", fetcher: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedPrefectDashboard("u1", "school-a", "year-1", "2026-11-26")?.presence.rate).toBe(67);
    await loadPrefectDashboard("u1", "school-a", "year-1", { today: "2026-11-26", fetcher: fetchMock, force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body).toEqual({ action: "prefect-dashboard", schoolId: "school-a", schoolYearId: "year-1", today: "2026-11-26" });
  });

  it("flèche ronde de l'en-tête : relecture demandée seulement si elle a été touchée depuis la dernière lecture", async () => {
    expect(prefectDashboardNeedsLoad("u1", "school-a", "year-1", 0, "2026-11-26")).toBe(true);
    await loadPrefectDashboard("u1", "school-a", "year-1", { today: "2026-11-26", fetcher: fetcher(), headerRefresh: 0 });
    expect(prefectDashboardNeedsLoad("u1", "school-a", "year-1", 0, "2026-11-26")).toBe(false);
    expect(prefectDashboardNeedsLoad("u1", "school-a", "year-1", 1, "2026-11-26")).toBe(true);
    await loadPrefectDashboard("u1", "school-a", "year-1", { today: "2026-11-26", fetcher: fetcher(), headerRefresh: 1, force: true });
    expect(prefectDashboardNeedsLoad("u1", "school-a", "year-1", 1, "2026-11-26")).toBe(false);
  });

  it("erreur du serveur : message clair, rien gardé en mémoire", async () => {
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: "Réservé au Préfet d'études." }), { status: 403 })) as unknown as typeof fetch;
    await expect(loadPrefectDashboard("u1", "school-a", "year-1", { today: "2026-11-26", fetcher: failing })).rejects.toThrow("Réservé au Préfet d'études.");
    expect(cachedPrefectDashboard("u1", "school-a", "year-1", "2026-11-26")).toBeUndefined();
  });

  it("le Dashboard affiche « Pilotage de mes sections » seulement pour le Préfet, avec la carte « Absences approuvées aujourd'hui »", () => {
    const portal = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
    expect(portal).toContain("{isPrefectOfStudies(user) && <PrefectDashboardSection");
    const section = readFileSync(new URL("./PrefectDashboardSection.tsx", import.meta.url), "utf8");
    expect(section).toContain("Absences approuvées aujourd'hui");
    expect(section).not.toContain("Enseignants absents");
    expect(section).toContain("Pilotage de mes sections");
    expect(section).not.toMatch(/>\s*Actualiser\s*</);
    expect(section).not.toContain("RefreshCw");
    expect(section).toContain("subscribeStaffChildrenRefresh");
  });
});
