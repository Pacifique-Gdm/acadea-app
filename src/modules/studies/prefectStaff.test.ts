import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/auth", () => ({ getCurrentFirebaseIdToken: async () => "jeton" }));
vi.mock("../../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { cachedPrefectStaff, clearPrefectStaffCache, loadPrefectStaff, prefectStaffNeedsLoad } from "./prefectStaff";

const staff = { sections: ["Primaire"], today: "2026-11-26", teachers: [{ id: "t1", teacherName: "MBUYI Jean", courses: [], weeklyPeriods: 0, absentToday: true, upcomingAbsences: [], upcomingAbsenceCount: 0 }] };
const fetcher = () => vi.fn(async () => new Response(JSON.stringify(staff), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const portal = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
const content = readFileSync(new URL("./PrefectStaffContent.tsx", import.meta.url), "utf8");

describe("lot P3 : personnel des sections du Préfet d'études (écran)", () => {
  beforeEach(() => clearPrefectStaffCache());

  it("lecture gardée en mémoire ; relecture seulement après un appui sur la flèche de l'en-tête", async () => {
    const today = "2026-11-26";
    expect(prefectStaffNeedsLoad("u1", "school-a", "year-1", 0, today)).toBe(true);
    const fetchMock = fetcher();
    await loadPrefectStaff("u1", "school-a", "year-1", { headerRefresh: 0, today, fetcher: fetchMock });
    expect(cachedPrefectStaff("u1", "school-a", "year-1", today)?.teachers[0].teacherName).toBe("MBUYI Jean");
    expect(prefectStaffNeedsLoad("u1", "school-a", "year-1", 0, today)).toBe(false);
    expect(prefectStaffNeedsLoad("u1", "school-a", "year-1", 1, today)).toBe(true);
    const body = JSON.parse(String(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body).toEqual({ action: "prefect-staff", schoolId: "school-a", schoolYearId: "year-1", today });
  });

  it("erreur du serveur : message clair, rien gardé", async () => {
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: "Réservé au Préfet d'études." }), { status: 403 })) as unknown as typeof fetch;
    await expect(loadPrefectStaff("u1", "school-a", "year-1", { today: "2026-11-26", fetcher: failing })).rejects.toThrow("Réservé au Préfet d'études.");
    expect(cachedPrefectStaff("u1", "school-a", "year-1", "2026-11-26")).toBeUndefined();
  });

  it("aucun nouveau bouton du Menu : ajout dans le drawer existant « Personnels enseignants », pour le Préfet seulement", () => {
    expect(portal).not.toContain("Personnel de mes sections</strong>");
    expect(portal.match(/setDrawer\("teacher-personnel"\)/g)).toHaveLength(1);
    expect(portal).toContain('{isPrefectOfStudies(user) && <PrefectStaffContent uid={user.id} schoolId={school.id} schoolYearId={year.id} />}<PersonnelDrawerContent user={user} school={school} allowedRoles={["teacher"]}');
  });

  it("lecture seule : aucun bouton (ni « Actualiser »), flèche de l'en-tête écoutée", () => {
    expect(content).not.toContain("<button");
    expect(content).not.toMatch(/>\s*Actualiser\s*</);
    expect(content).toContain("subscribeStaffChildrenRefresh");
    expect(content).toContain("absences approuvées");
  });
});
