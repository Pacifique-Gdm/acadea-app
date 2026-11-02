import { readFileSync, readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";

const cssFile = readdirSync("dist/assets").find((name) => name.endsWith(".css"));
if (!cssFile) throw new Error("Compiler l'application avant les tests responsive.");
const css = readFileSync(`dist/assets/${cssFile}`, "utf8");

for (const [role, width] of [["Administrateur", 390], ["Secrétaire", 375]] as const) {
  test(`tableau ${role} lisible et défilable sur smartphone`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.setContent(`<main class="acadea-mobile-tables" style="width:100%;max-width:100%"><div class="max-w-full overflow-x-auto"><table class="w-full table-fixed text-sm"><thead><tr><th>Établissement</th><th>Montant net exigible</th><th>Actions</th></tr></thead><tbody><tr><td class="truncate" title="École avec un nom très long">École avec un nom très long</td><td>150 000,00 USD</td><td><button type="button">Voir le reçu</button></td></tr></tbody></table></div></main>`);
    await page.addStyleTag({ content: css });
    const state = await page.evaluate(() => {
      const table = document.querySelector("table")!;
      const wrapper = table.parentElement!;
      const header = table.querySelector("th")!;
      const cell = table.querySelector("td")!;
      return {
        headerWrap: getComputedStyle(header).whiteSpace,
        cellWrap: getComputedStyle(cell).whiteSpace,
        truncated: getComputedStyle(cell).textOverflow,
        scrollable: wrapper.scrollWidth > wrapper.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    expect(state).toEqual({ headerWrap: "nowrap", cellWrap: "nowrap", truncated: "clip", scrollable: true, pageOverflow: false });
    await expect(page.getByRole("button", { name: "Voir le reçu" })).toBeVisible();
  });
}

test("la disposition des tableaux reste inchangée sur ordinateur", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<main class="acadea-mobile-tables"><div><table class="table-fixed"><tr><td>Texte long autorisant le retour à la ligne</td></tr></table></div></main>`);
  await page.addStyleTag({ content: css });
  expect(await page.locator("table").evaluate((table) => getComputedStyle(table).tableLayout)).toBe("fixed");
});
