import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/auth", () => ({ getCurrentFirebaseIdToken: async () => "jeton" }));
vi.mock("../../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { cachedPrefectDiscipline, clearPrefectDisciplineCache, loadPrefectDiscipline, prefectDisciplineNeedsLoad } from "./prefectDiscipline";

const sanction = { id: "d1", studentName: "KABEYA Grâce", className: "3ème Primaire", reason: "Retards", sanctionType: "Avertissement", duration: 0, startDate: "2026-11-24", expectedEndDate: "2026-11-24", status: "active", recurrenceNumber: 1 };
const fetcher = () => vi.fn(async () => new Response(JSON.stringify({ sanctions: [sanction] }), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const portal = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
const content = readFileSync(new URL("./PrefectDisciplineContent.tsx", import.meta.url), "utf8");

describe("lot P2 : discipline du Préfet d'études (écran)", () => {
  beforeEach(() => clearPrefectDisciplineCache());

  it("lecture gardée en mémoire ; relecture seulement après un appui sur la flèche de l'en-tête", async () => {
    expect(prefectDisciplineNeedsLoad("u1", "school-a", "year-1", 0)).toBe(true);
    const fetchMock = fetcher();
    await loadPrefectDiscipline("u1", "school-a", "year-1", { headerRefresh: 0, fetcher: fetchMock });
    expect(cachedPrefectDiscipline("u1", "school-a", "year-1")?.[0].studentName).toBe("KABEYA Grâce");
    expect(prefectDisciplineNeedsLoad("u1", "school-a", "year-1", 0)).toBe(false);
    expect(prefectDisciplineNeedsLoad("u1", "school-a", "year-1", 1)).toBe(true);
    const body = JSON.parse(String(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body).toEqual({ action: "prefect-discipline", schoolId: "school-a", schoolYearId: "year-1" });
  });

  it("erreur du serveur : message clair, rien gardé", async () => {
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: "Réservé au Préfet d'études." }), { status: 403 })) as unknown as typeof fetch;
    await expect(loadPrefectDiscipline("u1", "school-a", "year-1", { fetcher: failing })).rejects.toThrow("Réservé au Préfet d'études.");
    expect(cachedPrefectDiscipline("u1", "school-a", "year-1")).toBeUndefined();
  });

  it("bouton « Discipline » juste après « Enfants », pour le Préfet seulement", () => {
    expect(portal).toContain('<StaffChildrenEntry school={school} />{isPrefectOfStudies(user) && <button type="button" className={menuButton} onClick={() => setDrawer("grade-validation")}><ClipboardCheck className="h-5 w-5 shrink-0"/><strong>Validation des bulletins</strong></button>}{isPrefectOfStudies(user) && <button type="button" className={menuButton} onClick={() => setDrawer("prefect-discipline")}>');
    expect(portal).toContain('{drawer === "prefect-discipline" && isPrefectOfStudies(user) && <AdminDrawer title="Discipline"');
  });

  it("drawer en lecture seule : aucun bouton, ni « Actualiser » ni modification ; flèche de l'en-tête écoutée", () => {
    expect(content).not.toContain("<button");
    expect(content).not.toMatch(/>\s*Actualiser\s*</);
    expect(content).toContain("subscribeStaffChildrenRefresh");
    expect(content).toContain("Lecture seule");
  });
});
