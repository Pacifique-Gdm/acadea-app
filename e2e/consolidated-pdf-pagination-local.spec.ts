import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const origin = "http://127.0.0.1:5173";

test("PDF Tableau de cotes : classes séparées et long tableau avec en-têtes répétés", async ({ page }) => {
  test.setTimeout(180_000);
  if (process.env.ACADEA_E2E_BASE_URL !== origin || process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea"
    || process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES") throw new Error("PDF E2E réservé au navigateur local isolé.");
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !["127.0.0.1", "localhost"].includes(url.hostname)) {
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/login`);

  async function generate(label: string, classCount: number, studentCount: number, selectedStudentId = "") {
    await page.evaluate(async ({ classCount, studentCount, selectedStudentId }) => {
      const { exportConsolidatedGradesPdf } = await import("/src/modules/teacher/consolidatedGradesPdf.ts");
      const slots = ["period_1", "period_2", "semester_1_exam", "period_3", "period_4", "semester_2_exam"];
      const report = (classIndex: number) => ({
        courses: [{ key: "math", classId: `class-${classIndex}`, subjectId: "math", name: "Mathématiques" }],
        students: Array.from({ length: studentCount }, (_, index) => ({
          student: { id: `student-${classIndex}-${index}`, nom: `Élève ${index + 1}`, postnom: "", prenom: "Test" },
          scores: { math: Object.fromEntries(slots.map((slot) => [slot, index % 21])) },
          maxima: { math: Object.fromEntries(slots.map((slot) => [slot, 20])) },
          statuses: { math: {} },
          evaluations: Object.fromEntries(slots.map((slot) => [slot, { score: null, maximum: null, percentage: null, rank: null, complete: false }])),
        })),
      });
      const classes = Array.from({ length: classCount }, (_, index) => ({ report: report(index), className: `Classe ${String.fromCharCode(65 + index)}` }));
      await exportConsolidatedGradesPdf({ report: classes[0].report, className: classes[0].className, classes,
        school: { id: "pdf-test", name: "École fictive PDF", currency: "USD" },
        year: { id: "pdf-year", name: "2027-2028" }, tab: "grades", filter: { mode: selectedStudentId ? "student" : "period", choice: selectedStudentId, placeSlot: "period_1" } });
    }, { classCount, studentCount, selectedStudentId });
    await expect(page.locator("[data-pdf-download]")).toHaveAttribute("href", /^blob:/);
    const dataUrl = await page.evaluate(async () => {
      const blob = await (await fetch(document.querySelector<HTMLAnchorElement>("[data-pdf-download]")!.href)).blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    });
    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    await writeFile(test.info().outputPath(`${label}.pdf`), bytes);
    const loadingTask = getDocument({ data: new Uint8Array(bytes) });
    const document = await loadingTask.promise;
    const pages = document.numPages;
    await loadingTask.destroy();
    await page.locator("[data-pdf-close]").click();
    return pages;
  }

  expect(await generate("one-class", 1, 2)).toBe(1);
  expect(await generate("two-classes", 2, 2)).toBe(2);
  expect(await generate("three-classes", 3, 2)).toBe(3);
  expect(await generate("long-class", 1, 65)).toBeGreaterThan(1);
  expect(await generate("one-student-all-periods", 1, 2, "student-0-0")).toBe(1);
});
