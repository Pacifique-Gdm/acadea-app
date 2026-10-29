import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { build } from "esbuild";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";

test("les exports PDF Élèves réels présentent la date civile dans les deux parcours partagés", async () => {
  test.setTimeout(180_000);
  if (process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea" || process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES") {
    throw new Error("Preuve PDF réservée aux données fictives locales.");
  }
  const bundlePath = test.info().outputPath("student-birthdate-proof.js");
  await build({ entryPoints: [resolve("src/utils/studentPdf.ts")], outfile: bundlePath, bundle: true,
    platform: "browser", format: "iife", globalName: "StudentPdfProof", logLevel: "silent",
    define: { "import.meta.env": JSON.stringify({ DEV: true, VITE_APP_ENV: "staging" }) },
    // La mise en page est réelle, mais cette preuve locale ne doit initialiser aucun SDK Firebase.
    plugins: [{ name: "pdf-proof-offline", setup(builder) {
      builder.onResolve({ filter: /^\.\.\/firebase$/ }, (args) => args.importer.endsWith("schoolSubclasses.ts") ? { path: "firebase-offline", namespace: "pdf-proof" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "pdf-proof" }, () => ({ contents: "export const db = null;", loader: "js" }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setContent("<!doctype html><html lang='fr'><body></body></html>");
    await page.addScriptTag({ path: bundlePath });
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => typeof (window as typeof window & { StudentPdfProof?: unknown }).StudentPdfProof)).toBe("object");
    for (const role of ["administrateur", "secretaire"]) {
      await page.evaluate(async () => {
        const generator = (window as typeof window & { StudentPdfProof: { exportStudentsPdf: (...args: unknown[]) => Promise<void> } }).StudentPdfProof;
        await generator.exportStudentsPdf(
          { id: "e2e-school", name: "École fictive", activeSchoolYearId: "e2e-year", status: "active", address: "", phone: "", email: "", schoolOptionDisplayNames: { Sciences: "Technologies" } },
          { id: "e2e-year", schoolId: "e2e-school", name: "2027-2028", status: "active" },
          [{ id: "pupil-1", schoolId: "e2e-school", schoolYearId: "e2e-year", matricule: "E2E-1", nom: "ALPHA", postnom: "", prenom: "Alice", sexe: "F", className: "1ère Humanité", option: "Sciences", birthDate: "2012-09-25", phone: "0999000000" },
           { id: "pupil-2", schoolId: "e2e-school", schoolYearId: "e2e-year", matricule: "E2E-2", nom: "BETA", postnom: "", prenom: "Boris", sexe: "M", className: "1ère Humanité" }],
          ["Élèves fictifs"],
        );
      });
      const link = page.locator("[data-pdf-download]");
      await expect(link).toHaveAttribute("href", /^blob:/);
      const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).arrayBuffer())));
      const pdf = new Uint8Array(bytes);
      expect(pdf.length).toBeGreaterThan(1_000);
      // pdf.js transfère son tampon au worker ; garder l'original pour la preuve écrite.
      const document = await getDocument({ data: pdf.slice() }).promise;
      expect(document.numPages).toBeGreaterThanOrEqual(1);
      await writeFile(test.info().outputPath(`eleves-${role}.pdf`), pdf);
      for (let number = 1; number <= document.numPages; number++) {
        const pdfPage = await document.getPage(number);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await pdfPage.render({ canvasContext: canvas.getContext("2d") as never, viewport, canvas: canvas as never }).promise;
        await writeFile(test.info().outputPath(`eleves-${role}-page-${number}.png`), canvas.toBuffer("image/png"));
      }
      await page.locator("[data-pdf-close]").click();
    }
  } finally { await browser.close(); }
});
