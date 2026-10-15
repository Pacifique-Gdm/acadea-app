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
  console.info(`Calendrier public : ${analysis.candidates.length} propositions non validées, ${analysis.warnings.length} avertissements.`);
});
