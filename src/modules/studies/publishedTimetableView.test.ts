import { describe, expect, it, vi } from "vitest";
import { emptyPublishedTimetableFilters, exportPublishedTimetablePdf, filterPublishedTimetable, publishedTimetableFilterLabel } from "./publishedTimetableView";
import type { PublishedTimetableRow } from "./publishedTimetableService";

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("../../utils/pdf", () => ({
  pdfTable: (_columns: unknown, selectedRows: PublishedTimetableRow[]) => JSON.stringify(selectedRows),
  pdfSection: (title: string, content: string) => `${title}:${content}`,
  renderAcadPdfPreview: mocks.render,
}));

const rows: PublishedTimetableRow[] = [
  { dayOfWeek: "monday", periodLabel: "08:00", startTime: "08:00", classLabel: "1ère Sciences", subjectLabel: "Mathématiques", teacherDisplayName: "Alice" },
  { dayOfWeek: "monday", periodLabel: "09:00", startTime: "09:00", classLabel: "2ème Sciences", subjectLabel: "Français", teacherDisplayName: "Bob" },
  { dayOfWeek: "tuesday", periodLabel: "08:00", startTime: "08:00", classLabel: "1ère Sciences", subjectLabel: "Français", teacherDisplayName: "Alice" },
];

describe("horaire publié filtré", () => {
  it("filtre séparément par classe, enseignant ou jour sans toucher aux autres lignes", () => {
    expect(filterPublishedTimetable(rows, { type: "class", value: "1ère Sciences" }).rows).toEqual([rows[0], rows[2]]);
    expect(filterPublishedTimetable(rows, { type: "teacher", value: "Bob" }).rows).toEqual([rows[1]]);
    const result = filterPublishedTimetable(rows, { type: "day", value: "monday" });
    expect(result.rows).toEqual([rows[0], rows[1]]);
    expect(rows).toHaveLength(3);
    expect(publishedTimetableFilterLabel(result.filters, result.rows)).toContain("Lundi");
  });

  it("ignore les filtres persistés qui ne figurent plus parmi les données autorisées", () => {
    const result = filterPublishedTimetable(rows, { type: "teacher", value: "Inconnu" });
    expect(result.filters).toEqual({ type: "teacher", value: "" });
    expect(result.rows).toEqual(rows);
  });

  it("permet la remise à zéro", () => {
    expect(filterPublishedTimetable(rows, emptyPublishedTimetableFilters).rows).toHaveLength(3);
  });

  it("exporte uniquement les lignes filtrées avec l'école, l'année et une page paysage", async () => {
    const selected = filterPublishedTimetable(rows, { type: "teacher", value: "Alice" });
    await exportPublishedTimetablePdf({ school: { id: "school-a", name: "École A" } as never,
      year: { id: "year-a", name: "2026-2027" } as never, rows: selected.rows, filters: selected.filters });
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ title: "Horaire publié", orientation: "landscape",
      subtitle: expect.stringContaining("Alice"), sections: [expect.stringContaining(JSON.stringify([rows[0], rows[2]]))] }));
  });
});
