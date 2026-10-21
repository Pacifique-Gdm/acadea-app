import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { chromium, expect, test } from "@playwright/test";
import { build } from "esbuild";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";

type Scenario = { label: string; classCount: number; studentCount: number; selectedStudentId?: string };

test("chaque cours et sa première ligne commencent sur une nouvelle page physique du PDF", async () => {
  test.setTimeout(240_000);
  if (process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea" || process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES") {
    throw new Error("PDF E2E réservé aux données fictives locales.");
  }

  const bundlePath = test.info().outputPath("consolidated-grades-pdf.js");
  await build({
    entryPoints: [resolve("src/modules/teacher/consolidatedGradesPdf.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "PdfProof",
    logLevel: "silent",
    define: { "import.meta.env": JSON.stringify({
      DEV: true, VITE_APP_ENV: "staging", VITE_LOCAL_EMULATORS: "true",
      VITE_FIREBASE_API_KEY: "test-public-api-key", VITE_FIREBASE_AUTH_DOMAIN: "demo-acadea.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-acadea", VITE_FIREBASE_STORAGE_BUCKET: "demo-acadea.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "123", VITE_FIREBASE_APP_ID: "1:123:web:test",
    }) },
  });

  const browser = await chromium.launch({ headless: true });
  const worker = await createWorker("fra", undefined, {
    langPath: resolve("node_modules/@tesseract.js-data/fra/4.0.0_best_int"),
    cacheMethod: "none",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/*", (route) => route.abort());
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ path: bundlePath });

    async function generate({ label, classCount, studentCount, selectedStudentId = "" }: Scenario) {
      const dataUrl = await page.evaluate(async ({ classCount, studentCount, selectedStudentId }) => {
        const slots = ["period_1", "period_2", "semester_1_exam", "period_3", "period_4", "semester_2_exam"];
        const makeClass = (classIndex: number) => {
          const courses = ["Mathématiques", "Français", "Sciences"].map((name, courseIndex) => ({
            key: `class-${classIndex}-course-${courseIndex}`, classId: `class-${classIndex}`,
            subjectId: `subject-${courseIndex}`, name,
          }));
          const students = Array.from({ length: studentCount }, (_, index) => ({
            student: { id: `student-${classIndex}-${index}`, nom: `Élève ${index + 1}`, postnom: "", prenom: "Test" },
            scores: Object.fromEntries(courses.map((course) => [course.key, Object.fromEntries(slots.map((slot) => [slot, index + 1]))])),
            maxima: Object.fromEntries(courses.map((course) => [course.key, Object.fromEntries(slots.map((slot) => [slot, 20]))])),
            statuses: Object.fromEntries(courses.map((course) => [course.key, {}])),
            evaluations: Object.fromEntries(slots.map((slot) => [slot, { score: null, maximum: null, percentage: null, rank: null, complete: false }])),
          }));
          return { report: { courses, students }, className: `Classe ${String.fromCharCode(65 + classIndex)}` };
        };
        const classes = Array.from({ length: classCount }, (_, index) => makeClass(index));
        const proof = (window as Window & { PdfProof: typeof import("../src/modules/teacher/consolidatedGradesPdf") }).PdfProof;
        await proof.exportConsolidatedGradesPdf({
          report: classes[0].report as never, className: classes[0].className, classes: classes as never,
          school: { id: "pdf-test", name: "École fictive PDF", currency: "USD" } as never,
          year: { id: "pdf-year", name: "2027-2028" } as never,
          tab: "grades", filter: { mode: selectedStudentId ? "student" : "period", choice: selectedStudentId, placeSlot: "period_1" },
        });
        const anchor = document.querySelector<HTMLAnchorElement>("[data-pdf-download]");
        if (!anchor?.href.startsWith("blob:")) throw new Error("Aucun PDF généré.");
        const blob = await (await fetch(anchor.href)).blob();
        return await new Promise<string>((resolveData, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolveData(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }, { classCount, studentCount, selectedStudentId });

      const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
      await writeFile(test.info().outputPath(`${label}.pdf`), bytes);
      const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const document = await task.promise;
      const pageTexts: string[] = [];
      try {
        for (let index = 1; index <= document.numPages; index++) {
          const pdfPage = await document.getPage(index);
          const viewport = pdfPage.getViewport({ scale: 2 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await pdfPage.render({ canvasContext: canvas.getContext("2d") as never, viewport, canvas: canvas as never }).promise;
          const png = canvas.toBuffer("image/png");
          await writeFile(test.info().outputPath(`${label}-page-${index}.png`), png);
          pageTexts.push((await worker.recognize(png)).data.text);
        }
      } finally {
        await task.destroy();
        await page.locator("[data-pdf-close]").click();
      }
      return pageTexts;
    }

    const titles = ["Mathématiques", "Français", "Sciences"];
    const assertCourseStarts = (pages: string[], firstPageIndexes: number[], classLabel: string) => {
      firstPageIndexes.forEach((pageIndex, courseIndex) => {
        expect(pages[pageIndex]).toContain(titles[courseIndex]);
        expect(pages[pageIndex].normalize("NFD").replace(/\p{Diacritic}/gu, "")).toContain(classLabel);
        expect(pages[pageIndex]).toMatch(/Élève/i);
      });
    };

    const short = await generate({ label: "three-short-courses", classCount: 1, studentCount: 2 });
    expect(short).toHaveLength(3);
    assertCourseStarts(short, [0, 1, 2], "Classe A");

    const long = await generate({ label: "three-long-courses", classCount: 1, studentCount: 28 });
    expect(long).toHaveLength(6);
    assertCourseStarts(long, [0, 2, 4], "Classe A");
    [1, 3, 5].forEach((pageIndex, courseIndex) => {
      expect(long[pageIndex]).toContain(titles[courseIndex]);
      expect(long[pageIndex]).toMatch(/suite/i);
      expect(long[pageIndex]).toMatch(/Élève/i);
    });

    const multiple = await generate({ label: "two-classes-six-courses", classCount: 2, studentCount: 2 });
    expect(multiple).toHaveLength(6);
    assertCourseStarts(multiple, [0, 1, 2], "Classe A");
    assertCourseStarts(multiple, [3, 4, 5], "Classe B");

    const filtered = await generate({ label: "one-student-all-periods", classCount: 1, studentCount: 2, selectedStudentId: "student-0-0" });
    expect(filtered).toHaveLength(3);
    assertCourseStarts(filtered, [0, 1, 2], "Classe A");
    filtered.forEach((text) => expect(text).not.toContain("Élève 2 Test"));
  } finally {
    await worker.terminate();
    await browser.close();
  }
});
