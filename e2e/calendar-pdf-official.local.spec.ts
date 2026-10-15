import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";

const officialPdf = process.env.ACADEA_OFFICIAL_CALENDAR_PDF;

test("qualification OCR du calendrier public RDC 2026-2027 sur sept pages", async ({ page }) => {
  test.skip(!officialPdf || !existsSync(officialPdf), "Le PDF public de test n'est pas présent localement.");
  test.setTimeout(240_000);
  await page.goto("/e2e/fixtures/calendar-pdf-ocr.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.getByLabel("PDF officiel local").setInputFiles(officialPdf!);
  await page.getByRole("button", { name: "Analyser le PDF local fourni" }).click();
  const output = page.locator("#result");
  await expect(output).not.toHaveText("Analyse en cours", { timeout: 220_000 });
  const text = await output.textContent();
  expect(text).not.toMatch(/^ERREUR/);
  const analysis = JSON.parse(text ?? "{}");
  expect(analysis.pageCount).toBe(7);
  expect(analysis.warnings.some((warning: string) => warning.includes("OCR locale utilisée pour les pages 1, 2, 3, 4, 5, 6, 7"))).toBe(true);
  expect(analysis.candidates.length).toBeGreaterThan(0);
  expect(analysis.candidates.every((candidate: { uncertain: boolean; reviewed: boolean; sourcePage: number }) => candidate.uncertain && !candidate.reviewed && candidate.sourcePage >= 1 && candidate.sourcePage <= 7)).toBe(true);
  expect(analysis.documentYear).toBe("2026-2027");
  expect(analysis.candidates.every((candidate: { selected: boolean; status: string; suspendsCourses: boolean; sourceExcerpt: string }) => !candidate.selected && candidate.status === "to-review" && !candidate.suspendsCourses && Boolean(candidate.sourceExcerpt))).toBe(true);
  const reference = [
    { page: 3, level: "Maternelle", kind: "vacation", start: "2026-12-23", end: "2027-01-09" },
    { page: 4, level: "Primaire", kind: "vacation", start: "2026-12-23", end: "2027-01-09" },
    { page: 4, level: "Primaire", kind: "activity", start: "2027-05-29", end: "2027-05-29" },
    { page: 5, level: "Secondaire et Technique", kind: "vacation", start: "2026-12-23", end: "2027-01-09" },
    { page: 5, level: "Secondaire et Technique", kind: "resumption", start: "2027-02-22", end: "2027-02-22" },
    { page: 6, level: "Secondaire cycle court", kind: "exam", start: "2027-05-04", end: "2027-05-04" },
    { page: 6, level: "Secondaire cycle long", kind: "exam", start: "2027-02-13", end: "2027-02-13" },
    { page: 6, level: "Tous niveaux", kind: "holiday", start: "2026-12-25", end: "2026-12-25" },
    { page: 6, level: "Tous niveaux", kind: "holiday", start: "2027-01-01", end: "2027-01-01" },
  ];
  for (const expected of reference) expect(analysis.candidates.some((candidate: { sourcePage: number; educationLevel: string; kind: string; startsAt: string; endsAt: string }) => candidate.sourcePage === expected.page && candidate.educationLevel === expected.level && candidate.kind === expected.kind && candidate.startsAt === expected.start && candidate.endsAt === expected.end), JSON.stringify(expected)).toBe(true);
  const additionalReference = [
    { page: 3, level: "Maternelle", kind: "vacation", start: "2026-11-05", end: "2026-11-07" },
    { page: 3, level: "Maternelle", kind: "exam", start: "2026-12-10", end: "2026-12-17" },
    { page: 3, level: "Maternelle", kind: "vacation", start: "2027-03-22", end: "2027-04-03" },
    { page: 4, level: "Primaire", kind: "vacation", start: "2026-11-05", end: "2026-11-07" },
    { page: 4, level: "Primaire", kind: "exam", start: "2026-12-10", end: "2026-12-17" },
    { page: 4, level: "Primaire", kind: "vacation", start: "2027-03-22", end: "2027-04-03" },
    { page: 5, level: "Secondaire et Technique", kind: "vacation", start: "2026-11-05", end: "2026-11-07" },
    { page: 5, level: "Secondaire et Technique", kind: "exam", start: "2027-02-09", end: "2027-02-17" },
    { page: 5, level: "Secondaire et Technique", kind: "vacation", start: "2027-03-22", end: "2027-04-03" },
    { page: 5, level: "Secondaire et Technique", kind: "resumption", start: "2027-04-05", end: "2027-04-05" },
    { page: 5, level: "Secondaire et Technique", kind: "exam", start: "2027-05-24", end: "2027-06-01" },
    { page: 6, level: "Secondaire cycle long", kind: "exam", start: "2027-05-05", end: "2027-05-08" },
  ];
  const missing = additionalReference.filter((expected) => !analysis.candidates.some((candidate: { sourcePage: number; educationLevel: string; kind: string; startsAt: string; endsAt: string }) => candidate.sourcePage === expected.page && candidate.educationLevel === expected.level && candidate.kind === expected.kind && candidate.startsAt === expected.start && candidate.endsAt === expected.end));
  for (const expected of missing) {
    const nearby = analysis.candidates.filter((candidate: { sourcePage: number; kind: string }) => candidate.sourcePage === expected.page && candidate.kind === expected.kind).map((candidate: { title: string; educationLevel: string; startsAt: string; endsAt: string; sourceExcerpt: string }) => ({ title: candidate.title, level: candidate.educationLevel, start: candidate.startsAt, end: candidate.endsAt, excerpt: candidate.sourceExcerpt.slice(0, 100) }));
    console.info(`Référence non exacte ${JSON.stringify(expected)} ; propositions proches ${JSON.stringify(nearby)}`);
  }
  const needsManualCorrection = analysis.candidates.filter((candidate: { title: string; educationLevel: string }) => candidate.educationLevel === "Non déterminé" || /1°["’]/.test(candidate.title));
  const incomplete = analysis.candidates.filter((candidate: { startsAt: string; endsAt: string }) => !candidate.startsAt || !candidate.endsAt);
  console.info(`Référence contrôlée : ${reference.length + additionalReference.length - missing.length}/${reference.length + additionalReference.length} dates/niveaux détectés exactement ; ${missing.length} dates non extraites ; ${incomplete.length} propositions incomplètes à compléter ; ${needsManualCorrection.length} titres/niveaux à corriger manuellement.`);
  expect(analysis.candidates.some((candidate: { sourcePage: number; startsAt: string; kind: string }) => candidate.sourcePage === 5 && candidate.kind === "resumption" && candidate.startsAt === "2027-04-06")).toBe(false);
  expect(analysis.candidates.some((candidate: { sourcePage: number }) => candidate.sourcePage === 7)).toBe(false);
  console.info(`Calendrier public : ${analysis.candidates.length} propositions non validées, ${analysis.warnings.length} avertissements.`);
});
