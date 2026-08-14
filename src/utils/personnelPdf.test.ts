import { describe, expect, it, vi } from "vitest";
import type { AppUser, School } from "../types";

const renderAcadPdfPreview = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", () => ({ renderAcadPdfPreview, escapePdfHtml: (value: unknown) => String(value ?? ""), pdfSection: (title: string, body: unknown) => ({ title, body }), pdfInfoGrid: (rows: unknown) => rows, pdfTable: (_columns: unknown, rows: unknown) => rows }));
import { printPersonnelListPdf, printPersonnelProfilePdf } from "./personnelPdf";

describe("fiche individuelle du personnel", () => {
  it("imprime uniquement le personnel sélectionné et tolère les champs optionnels", async () => {
    const school = { id: "school-a", name: "École A" } as School;
    const personnel = { id: "teacher-a", name: "Alice", email: "alice@example.test", role: "teacher", schoolId: "school-a", sectionIds: ["CTEB"] } as AppUser;
    await printPersonnelProfilePdf(school, personnel, new Date("2026-08-13T12:00:00Z"));
    expect(renderAcadPdfPreview).toHaveBeenCalledWith(expect.objectContaining({ filename: "fiche-personnel-teacher-a.pdf", title: "FICHE INDIVIDUELLE DU PERSONNEL", school, singlePageFit: true }));
    expect(JSON.stringify(renderAcadPdfPreview.mock.calls[0][0])).toContain("Alice");
    expect(JSON.stringify(renderAcadPdfPreview.mock.calls[0][0])).not.toContain("teacher-b");
  });

  it("utilise la date initiale users, affiche la photo et exclut année scolaire et mot de passe", async () => {
    const school = { id: "school-a", name: "École A" } as School;
    const personnel = { id: "teacher-a", name: "Alice", email: "alice@example.test", role: "teacher", schoolId: "school-a", createdAt: "2024-02-03T00:00:00.000Z" } as AppUser;
    await printPersonnelProfilePdf(school, personnel, { id: "teacher-a", personnelId: "teacher-a", schoolId: "school-a", matricule: "PER-000001", photoUrl: "https://example.test/photo.jpg", createdAt: "2026-01-01", createdBy: "admin", updatedAt: "2026-01-01", updatedBy: "admin" });
    const serialized = JSON.stringify(renderAcadPdfPreview.mock.calls.at(-1)?.[0]);
    expect(serialized).toContain("03/02/2024");
    expect(serialized).toContain("photo.jpg");
    expect(serialized).not.toMatch(/année scolaire|mot de passe/i);
    expect(serialized).not.toContain("01/01/2026");
  });

  it("rend les observations longues dans une section pleine largeur distincte de la grille", async () => {
    const school = { id: "school-a", name: "École A" } as School;
    const personnel = { id: "teacher-a", name: "Alice", email: "alice@example.test", role: "teacher", schoolId: "school-a" } as AppUser;
    const observations = "Observation professionnelle longue ".repeat(40);

    await printPersonnelProfilePdf(school, personnel, {
      id: "teacher-a", personnelId: "teacher-a", schoolId: "school-a", matricule: "PER-000001",
      observations, createdAt: "2026-01-01", createdBy: "admin", updatedAt: "2026-01-01", updatedBy: "admin",
    });

    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    expect(options.singlePageFit).toBe(false);
    expect(options.sections.at(-1)).toEqual({
      title: "Observations",
      body: `<p class="personnel-observations">${observations}</p>`,
    });
    expect(JSON.stringify(options.sections[0])).not.toContain(observations);
  });
});

describe("liste filtrée du personnel", () => {
  it("imprime exactement le tableau actif fourni par l'interface", async () => {
    const school = { id: "school-a", name: "École A" } as School;
    const active = [{ id: "active-a", name: "Alice", email: "alice@example.test", role: "teacher", schoolId: "school-a" }] as AppUser[];
    await printPersonnelListPdf(school, active, "active", new Date("2026-08-14T12:00:00Z"));
    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    expect(options).toEqual(expect.objectContaining({ title: "Liste du personnel actif", school }));
    expect(JSON.stringify(options)).toContain("active-a");
    expect(JSON.stringify(options)).not.toContain("archived-b");
  });

  it("reflète le filtre archivé dans le titre et les seules lignes fournies", async () => {
    const school = { id: "school-a", name: "École A" } as School;
    const archived = [{ id: "archived-b", name: "Bob", email: "bob@example.test", role: "cashier", schoolId: "school-a", status: "inactive" }] as AppUser[];
    await printPersonnelListPdf(school, archived, "archived");
    const options = renderAcadPdfPreview.mock.calls.at(-1)?.[0];
    expect(options).toEqual(expect.objectContaining({ title: "Liste du personnel archivé" }));
    expect(JSON.stringify(options)).toContain("archived-b");
    expect(JSON.stringify(options)).not.toContain("active-a");
  });
});
