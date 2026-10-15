import { jsPDF } from "jspdf";
import { describe, expect, it } from "vitest";
import type { SchoolYear } from "../../types";
import { analyzeCalendarPdf } from "./calendarPdfImport";

const year = { id: "year-a", schoolId: "school-a", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-31", status: "active" } as SchoolYear;
const file = (pdf: jsPDF) => new File([pdf.output("arraybuffer")], "calendrier.pdf", { type: "application/pdf" });

describe("extraction depuis de vrais octets PDF", () => {
  it("extrait un tableau texte réparti sur deux pages", async () => {
    const pdf = new jsPDF();
    pdf.text("CALENDRIER MATERNELLE", 10, 20);
    pdf.text("Vacances scolaires du 20/12/2026 au 05/01/2027", 10, 30);
    pdf.addPage();
    pdf.text("SECONDAIRE ET TECHNIQUE", 10, 20);
    pdf.text("Examens semestriels 13 janvier 2027", 10, 30);
    const analysis = await analyzeCalendarPdf(file(pdf), year, () => undefined);
    expect(analysis.pageCount).toBe(2);
    expect(analysis.candidates).toMatchObject([
      { kind: "vacation", educationLevel: "Maternelle", sourcePage: 1 },
      { kind: "exam", educationLevel: "Secondaire et Technique", sourcePage: 2 },
    ]);
  });
  it("refuse un PDF sans texte exploitable sans inventer d'événements", async () => {
    await expect(analyzeCalendarPdf(file(new jsPDF()), year, () => undefined)).rejects.toThrow("PDF sans texte exploitable");
  });
  it("refuse une fausse extension PDF", async () => {
    const invalid = new File(["not a pdf"], "faux.pdf", { type: "application/pdf" });
    await expect(analyzeCalendarPdf(invalid, year, () => undefined)).rejects.toThrow("signature PDF");
  });
});
