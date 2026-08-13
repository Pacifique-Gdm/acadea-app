import { describe, expect, it, vi } from "vitest";
import type { AppUser, School } from "../types";

const renderAcadPdfPreview = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", () => ({ renderAcadPdfPreview, pdfInfoGrid: (rows: unknown) => rows }));
import { printPersonnelProfilePdf } from "./personnelPdf";

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
