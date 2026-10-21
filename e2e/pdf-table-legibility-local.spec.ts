import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { chromium, expect, test } from "@playwright/test";
import { build } from "esbuild";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

test("les tableaux PDF représentatifs restent lisibles et entiers sur leurs pages physiques", async () => {
  test.setTimeout(180_000);
  if (process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea" || process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES") {
    throw new Error("Preuve PDF réservée aux données fictives locales.");
  }

  const bundlePath = test.info().outputPath("pdf-table-proof.js");
  await build({
    entryPoints: [resolve(process.env.PDF_PROOF_SOURCE_ROOT ?? ".", "src/utils/pdf.ts")], outfile: bundlePath, bundle: true,
    platform: "browser", format: "iife", globalName: "PdfProof", logLevel: "silent",
    define: { "import.meta.env": JSON.stringify({ DEV: true, VITE_APP_ENV: "staging" }) },
  });

  const phase = process.env.PDF_PROOF_PHASE === "before" ? "before" : "after";
  const proofDir = resolve("tmp/pdfs/table-legibility", phase);
  await mkdir(proofDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: bundlePath });

    const scenarios = [
      { label: "administrative-short-portrait", columns: 3, rows: 3, orientation: "portrait" },
      { label: "financial-long-portrait", columns: 5, rows: 45, orientation: "portrait" },
      { label: "wide-landscape", columns: 8, rows: 25, orientation: "landscape" },
    ] as const;

    for (const scenario of scenarios) {
      const dataUrl = await page.evaluate(async ({ columns, rows, orientation }) => {
        const proof = (window as Window & { PdfProof: typeof import("../src/utils/pdf") }).PdfProof;
        const values = Array.from({ length: rows }, (_, index) => ({
          name: `Élève fictif ${index + 1} au nom volontairement très long`,
          amount: `123456789,${String(index).padStart(2, "0")} USD`,
        }));
        const headings = Array.from({ length: columns }, (_, index) => ({
          header: index ? `Montant ${index}` : "Élève ou bénéficiaire",
          render: (row: typeof values[number]) => index ? row.amount : row.name,
        }));
        await proof.renderAcadPdfPreview({
          filename: "preuve-tableau-fictif.pdf", title: "Tableau fictif", throwOnError: true,
          school: { id: "pdf-fictif", name: "École fictive de vérification" } as never,
          orientation, sections: [proof.pdfSection("Données fictives", proof.pdfTable(headings, values, "Aucune valeur.", {
            footerHtml: columns === 5 ? '<tr><td colspan="5">TOTAL FICTIF : 123456789,45 USD</td></tr>' : undefined,
          }))],
        });
        const anchor = document.querySelector<HTMLAnchorElement>("[data-pdf-download]");
        if (!anchor?.href.startsWith("blob:")) throw new Error("PDF non généré.");
        const blob = await (await fetch(anchor.href)).blob();
        return await new Promise<string>((resolveData, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolveData(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }, scenario);

      const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
      await writeFile(resolve(proofDir, `${scenario.label}.pdf`), bytes);
      const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const document = await task.promise;
      try {
        expect(document.numPages).toBeGreaterThanOrEqual(scenario.rows > 3 ? 2 : 1);
        for (let index = 1; index <= document.numPages; index++) {
          const pdfPage = await document.getPage(index);
          const size = pdfPage.getViewport({ scale: 1 });
          expect(scenario.orientation === "portrait" ? size.height > size.width : size.width > size.height).toBe(true);
          const viewport = pdfPage.getViewport({ scale: 2 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext("2d");
          await pdfPage.render({ canvasContext: context as never, viewport, canvas: canvas as never }).promise;
          if (index > 1 && phase === "after") {
            const band = context.getImageData(0, 0, canvas.width, Math.min(320, canvas.height));
            let navyPixels = 0;
            for (let offset = 0; offset < band.data.length; offset += 12) {
              if (band.data[offset] < 55 && band.data[offset + 1] < 80 && band.data[offset + 2] < 125) navyPixels++;
            }
            expect(navyPixels, "l'en-tête foncé du tableau doit être répété sur la page physique").toBeGreaterThan(900);
          }
          await writeFile(resolve(proofDir, `${scenario.label}-page-${index}.png`), canvas.toBuffer("image/png"));
        }
      } finally {
        await task.destroy();
        await page.locator("[data-pdf-close]").click();
      }
    }
  } finally {
    await browser.close();
  }
});

test("le Tableau de cotes conserve dix colonnes et un cours par page A4 portrait", async () => {
  test.setTimeout(120_000);
  if (process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea" || process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES") {
    throw new Error("Preuve PDF réservée aux données fictives locales.");
  }
  const bundlePath = test.info().outputPath("grade-pdf-proof.js");
  await build({
    entryPoints: [resolve("src/modules/teacher/consolidatedGradesPdf.ts")], outfile: bundlePath,
    bundle: true, platform: "browser", format: "iife", globalName: "GradeProof", logLevel: "silent",
    define: { "import.meta.env": JSON.stringify({
      DEV: true, VITE_APP_ENV: "staging", VITE_LOCAL_EMULATORS: "true",
      VITE_FIREBASE_API_KEY: "test-public-api-key", VITE_FIREBASE_AUTH_DOMAIN: "demo-acadea.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-acadea", VITE_FIREBASE_STORAGE_BUCKET: "demo-acadea.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "123", VITE_FIREBASE_APP_ID: "1:123:web:test",
    }) },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: bundlePath });
    const dataUrl = await page.evaluate(async () => {
      const proof = (window as Window & { GradeProof: typeof import("../src/modules/teacher/consolidatedGradesPdf") }).GradeProof;
      const slots = ["period_1", "period_2", "semester_1_exam", "period_3", "period_4", "semester_2_exam"];
      const courses = ["Mathématiques", "Français", "Sciences"].map((name, index) => ({ key: `course-${index}`, classId: "class-a", subjectId: `subject-${index}`, name }));
      const students = Array.from({ length: 3 }, (_, index) => ({
        student: { id: `student-${index}`, nom: `Élève fictif ${index + 1} au nom long`, postnom: "", prenom: "Test" },
        scores: Object.fromEntries(courses.map((course) => [course.key, Object.fromEntries(slots.map((slot) => [slot, index ? 850 : 0]))])),
        maxima: Object.fromEntries(courses.map((course) => [course.key, Object.fromEntries(slots.map((slot) => [slot, 1200]))])),
        statuses: Object.fromEntries(courses.map((course) => [course.key, {}])),
        evaluations: Object.fromEntries(slots.map((slot) => [slot, { score: null, maximum: null, percentage: null, rank: null, complete: false }])),
      }));
      await proof.exportConsolidatedGradesPdf({
        report: { courses, students } as never, className: "Classe fictive A",
        school: { id: "pdf-fictif", name: "École fictive de vérification" } as never,
        year: { id: "pdf-year", name: "2027-2028" } as never,
        tab: "grades", filter: { mode: "period", choice: "", placeSlot: "period_1" },
      });
      const anchor = document.querySelector<HTMLAnchorElement>("[data-pdf-download]");
      if (!anchor?.href.startsWith("blob:")) throw new Error("PDF non généré.");
      const blob = await (await fetch(anchor.href)).blob();
      return await new Promise<string>((resolveData, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolveData(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    });
    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    const proofDir = resolve("tmp/pdfs/table-legibility/after");
    await mkdir(proofDir, { recursive: true });
    await writeFile(resolve(proofDir, "grade-three-courses.pdf"), bytes);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const document = await task.promise;
    try {
      expect(document.numPages).toBe(3);
      for (let index = 1; index <= document.numPages; index++) {
        const pdfPage = await document.getPage(index);
        const size = pdfPage.getViewport({ scale: 1 });
        expect(size.width).toBeCloseTo(595.28, 0);
        expect(size.height).toBeCloseTo(841.89, 0);
        const viewport = pdfPage.getViewport({ scale: 2 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await pdfPage.render({ canvasContext: canvas.getContext("2d") as never, viewport, canvas: canvas as never }).promise;
        await writeFile(resolve(proofDir, `grade-three-courses-page-${index}.png`), canvas.toBuffer("image/png"));
      }
    } finally {
      await task.destroy();
    }
  } finally {
    await browser.close();
  }
});
