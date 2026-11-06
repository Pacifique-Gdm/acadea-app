import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { chromium, expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const proofDir = resolve("tmp/pdfs/dashboard-amendment");

async function downloadPdfData(page: Page) {
  return page.evaluate(async () => {
    const anchor = document.querySelector<HTMLAnchorElement>("[data-pdf-download]");
    if (!anchor?.href.startsWith("blob:")) throw new Error("Aucun PDF produit.");
    const blob = await (await fetch(anchor.href)).blob();
    return new Promise<string>((resolveData, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolveData(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  });
}

async function inspectPhysicalPages(dataUrl: string, name: string) {
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  await writeFile(resolve(proofDir, `${name}.pdf`), bytes);
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  try {
    expect(pdf.numPages).toBeGreaterThan(1);
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const dimensions = page.getViewport({ scale: 1 });
      expect(dimensions.height).toBeGreaterThan(dimensions.width);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context as never, viewport, canvas: canvas as never }).promise;
      const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let offset = 0; offset < image.length; offset += 32) {
        if (image[offset] < 245 || image[offset + 1] < 245 || image[offset + 2] < 245) ink++;
      }
      expect(ink, `page physique ${number} blanche`).toBeGreaterThan(800);
      await writeFile(resolve(proofDir, `${name}-page-${number}.png`), canvas.toBuffer("image/png"));
    }
    return pdf.numPages;
  } finally {
    await task.destroy();
  }
}

test("les Dashboard école et Coordination produisent des PDF physiques multipages avec données fictives", async () => {
  test.setTimeout(240_000);
  if (process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea" || process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES") {
    throw new Error("Preuve PDF réservée à l'environnement fictif local.");
  }
  await mkdir(proofDir, { recursive: true });
  for (const [source, outfile, globalName] of [
    ["src/utils/dashboardPdf.ts", test.info().outputPath("dashboard-school-proof.js"), "DashboardProof"],
    ["src/modules/coordination/coordinationDashboardPdf.ts", test.info().outputPath("dashboard-coordination-proof.js"), "CoordinationProof"],
  ]) {
    await build({
      entryPoints: [resolve(source)], outfile, bundle: true, platform: "browser", format: "iife",
      globalName, logLevel: "silent",
      define: { "import.meta.env": JSON.stringify({ DEV: true, VITE_APP_ENV: "staging" }) },
    });
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: test.info().outputPath("dashboard-school-proof.js") });
    await page.addScriptTag({ path: test.info().outputPath("dashboard-coordination-proof.js") });

    await page.evaluate(async () => {
      const proof = (window as Window & { DashboardProof: typeof import("../src/utils/dashboardPdf") }).DashboardProof;
      const feeProgressRows = Array.from({ length: 16 }, (_, index) => ({
        name: `Frais fictif ${index + 1}`, official: 1_500_000, reduction: 250_000,
        expected: 1_250_000, paid: 750_000, remaining: 500_000, rate: 60,
      }));
      await proof.exportDashboardReportPdf({
        school: { id: "school-fictif", name: "École fictive A", currency: "CDF" } as never,
        year: { id: "year-fictif", schoolId: "school-fictif", name: "2027-2028", currency: "CDF" } as never,
        sectionLabel: "Toutes les sections", dateLabel: "Année scolaire complète",
        recoveryRate: 60, totalPayments: 12_000_000,
        arrearsCollections: [{ currency: "USD", amount: 50 }],
        historicalArrears: { USD: 75, CDF: 2_500_000 },
        totalExpenses: 800_000, official: 24_000_000, reduction: 4_000_000,
        expected: 20_000_000, remaining: 8_000_000,
        transactions: Array.from({ length: 12 }, (_, index) => ({
          id: `transaction-${index}`, type: "Paiement", label: "Caisse fictive",
          amount: 1_000_000, currency: "CDF" as const, date: "2026-11-05",
        })),
        classRows: Array.from({ length: 20 }, (_, index) => ({
          className: `Classe fictive ${index + 1}`, girls: 2, boys: 3, total: 5,
        })),
        totalGirls: 40, totalBoys: 60, totalStudents: 100, totalClasses: 20, totalParents: 80,
        administrators: 1, cashiers: 2, disciplineDirectors: 1,
        feeProgressRows, feeShares: [
          { name: "Frais payés", amount: 12_000_000, percentage: 60 },
          { name: "Impayés", amount: 8_000_000, percentage: 40 },
        ],
        transactionChartRows: Array.from({ length: 5 }, (_, index) => ({
          date: `2026-11-0${index + 1}`, label: `${index + 1} nov.`,
          payments: (index + 1) * 1_000_000, expenses: index * 100_000,
        })),
        transactionPeriodLabel: "5 derniers jours",
      });
    });
    const schoolPdf = await downloadPdfData(page);
    expect(await inspectPhysicalPages(schoolPdf, "school-dashboard")).toBeGreaterThan(1);
    await page.locator("[data-pdf-close]").click();

    await page.evaluate(async () => {
      const proof = (window as Window & { CoordinationProof: typeof import("../src/modules/coordination/coordinationDashboardPdf") }).CoordinationProof;
      const school = { id: "school-fictif", name: "École fictive B", currency: "USD" };
      const feeProgressRows = Array.from({ length: 12 }, (_, index) => ({
        name: `Frais fictif ${index + 1}`, official: 100, reduction: 10,
        expected: 90, paid: 60, remaining: 30, rate: 67,
      }));
      await proof.exportCoordinationDashboardPdf({
        coordination: { id: "coord-fictive", name: "Coordination fictive", referenceSchoolYear: "2027-2028" } as never,
        schools: [school as never], selectedSchoolId: school.id,
        stats: {
          alignedSchoolIds: [school.id], excludedSchoolIds: [],
          students: [], feeTypes: [], payments: [], expenses: [], cashInflows: [],
          totalStudents: 90, totalClasses: 18, totalParents: 75, administrators: 1, cashiers: 2, disciplineDirectors: 1,
          classRows: Array.from({ length: 18 }, (_, index) => ({
            schoolId: school.id, schoolName: school.name, className: `Classe ${index + 1}`,
            girls: 2, boys: 3, total: 5,
          })), totalGirls: 36, totalBoys: 54,
          financialGroups: [{
            currency: "USD", official: 1200, reduction: 120, expected: 1080, paid: 720,
            expenses: 150, cashInflows: 100, remaining: 360, recoveryRate: 67,
            feeProgressRows, feeShares: [
              { name: "Frais payés", amount: 720, percentage: 67 },
              { name: "Impayés", amount: 360, percentage: 33 },
            ], payments: [], expenseRows: [], cashInflowRows: [],
          }],
        } as never,
        historicalArrears: { USD: 48, CDF: 0 },
        arrearsCollections: [{ currency: "USD", amount: 12 }],
        sectionLabel: "Toutes les sections", dateLabel: "Année scolaire active",
        transactions: [{ id: "transaction-1", type: "Paiement", label: "École fictive B",
          amount: 60, currency: "USD", date: "2026-11-05" }],
        chartGroups: [{ currency: "USD", rows: Array.from({ length: 5 }, (_, index) => ({
          date: `2026-11-0${index + 1}`, label: `${index + 1} nov.`,
          payments: (index + 1) * 100, expenses: index * 20,
        })) }],
        transactionPeriodLabel: "5 derniers jours", showTransactionCharts: true,
      });
    });
    const coordinationPdf = await downloadPdfData(page);
    expect(await inspectPhysicalPages(coordinationPdf, "coordination-dashboard")).toBeGreaterThan(1);
  } finally {
    await browser.close();
  }
});
