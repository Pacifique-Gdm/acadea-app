import { describe, expect, it, vi } from "vitest";
import type { AppUser, School } from "../types";

const renderAcadPdfPreview = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", () => ({ renderAcadPdfPreview, pdfInfoGrid: (rows: unknown) => rows, pdfTable: (_columns: unknown, rows: unknown) => rows }));
import { printPersonnelListPdf, printPersonnelProfilePdf } from "./personnelPdf";

describe("fiche individuelle du personnel", () => {
  it("imprime uniquement le personnel sélectionné et tolère les champs optionnels", async () => {
    const school = { id: "school-a", name: "École A" } as School;
    const personnel = { id: "teacher-a", name: "Alice", email: "alice@example.test", role: "teacher", schoolId: "school-a", sectionIds: ["CTEB"] } as AppUser;
    await printPersonnelProfilePdf(school, personnel, new Date("2026-08-13T12:00:00Z"));
    expect(renderAcadPdfPreview).toHaveBeenCalledWith(expect.objectContaining({ filename: "fiche-personnel-teacher-a.pdf", title: "Fiche individuelle du personnel", school, singlePageFit: true }));
    expect(JSON.stringify(renderAcadPdfPreview.mock.calls[0][0])).toContain("Alice");
    expect(JSON.stringify(renderAcadPdfPreview.mock.calls[0][0])).not.toContain("teacher-b");
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
