import { expect, test } from "@playwright/test";

test("un PDF fictif numérisé de deux pages est reconnu localement et reste à vérifier", async ({ page }) => {
  test.setTimeout(180_000);
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text().slice(0, 160)); });
  page.on("pageerror", (error) => browserErrors.push(error.message.slice(0, 160)));
  await page.goto("/e2e/fixtures/calendar-pdf-ocr.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Analyser le PDF numérisé fictif" }).click();
  const output = page.locator("#result");
  await expect(output).not.toHaveText("Analyse en cours", { timeout: 120_000 });
  const text = await output.textContent();
  expect(text, browserErrors.join("; ")).not.toMatch(/^ERREUR/);
  const analysis = JSON.parse(text ?? "{}");
  expect(analysis.pageCount).toBe(2);
  expect(analysis.warnings).toContain("OCR locale utilisée pour les pages 1, 2. Vérifiez visuellement chaque date et chaque intitulé avant l'ajout au brouillon.");
  expect(analysis.candidates).toMatchObject([
    { sourcePage: 1, kind: "vacation", startsAt: "2026-12-20", uncertain: true, reviewed: false },
    { sourcePage: 2, kind: "exam", startsAt: "2027-01-13", uncertain: true, reviewed: false },
  ]);
});
