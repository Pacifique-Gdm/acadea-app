import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { formatCurrencyMoney } from "../src/utils/currency";

const stylesheet = (await postcss([tailwindcss({ config: "tailwind.config.js" })])
  .process(readFileSync("src/styles.css", "utf8"), { from: "src/styles.css" })).css;

test("les montants Arriérés héritent de la même typographie sans débordement, y compris deux devises", async ({ page }) => {
  const componentSource = readFileSync("src/components/financial/DashboardArrearsValue.tsx", "utf8");
  expect(componentSource).toContain('className="grid min-w-0 gap-1"');
  expect(componentSource).toContain('className="min-w-0 break-words"');
  for (const currencies of [["USD"], ["CDF"], ["USD", "CDF"]] as const) {
    const arrears = `<span class="grid min-w-0 gap-1" title="Dettes historiques">${currencies.map((currency) =>
      `<span class="min-w-0 break-words">${formatCurrencyMoney(currency === "USD" ? 1250000 : 1250000000, currency)}</span>`).join("")}</span>`;
    await page.setContent(`<html><head><style>${stylesheet}</style></head><body>
      <div class="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <article class="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-sm text-slate-500">Montant officiel</p>
          <p data-testid="official" class="mt-1 break-words text-2xl font-bold text-ink">${formatCurrencyMoney(1250000, "USD")}</p>
        </article>
        <article class="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <p class="text-sm text-slate-500">Arriérés</p>
          <p class="mt-1 break-words text-2xl font-bold text-ink">${arrears}</p>
        </article>
      </div></body></html>`);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const visual = await page.evaluate(() => {
        const official = document.querySelector<HTMLElement>("[data-testid='official']")!;
        const amounts = [...document.querySelectorAll<HTMLElement>("[title] > span")];
        const typography = (item: HTMLElement) => {
          const style = getComputedStyle(item);
          return { size: style.fontSize, weight: style.fontWeight, color: style.color, lineHeight: style.lineHeight };
        };
        return {
          official: typography(official), arrears: amounts.map(typography),
          overflow: [...document.querySelectorAll<HTMLElement>("article")].some((article) => article.scrollWidth > article.clientWidth + 1),
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
      expect(visual.arrears).toHaveLength(currencies.length);
      for (const amount of visual.arrears) expect(amount).toEqual(visual.official);
      expect(visual.overflow).toBe(false);
      expect(visual.pageOverflow).toBe(false);
      await page.screenshot({ path: test.info().outputPath(`arrears-${currencies.join("-")}-${width}.png`) });
    }
  }
});
