import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

test("fiche de cotation : PDF portrait multipage lisible avec zéros et cases vides", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES" || process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea"
    || process.env.ACADEA_E2E_BASE_URL !== "http://127.0.0.1:5173") {
    throw new Error("Ce test visuel est réservé au serveur local isolé demo-acadea.");
  }
  await page.route(/https:\/\/[^/]*(?:googleapis\.com|firebaseio\.com|firebasestorage\.app)/, (route) => route.abort());
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const { exportTeacherGradesPdf } = await import("/src/modules/teacher/teacherGradingPdf.ts");
    const schoolId = "e2e-pdf-school";
    const schoolYearId = "e2e-pdf-year";
    const classId = "e2e-pdf-class";
    const subjectId = "e2e-pdf-subject";
    const teacherId = "e2e-pdf-teacher";
    const scope = { schoolId, schoolYearId };
    const students = Array.from({ length: 31 }, (_, index) => ({
      id: `e2e-pdf-student-${index}`, ...scope, nom: `Élève ${String(index + 1).padStart(2, "0")}`,
      postnom: "Fictif", prenom: "Test", classId, status: "ACTIVE",
    }));
    const entries = [
      { id: "zero", studentId: students[0].id, gradingSlot: "period_1", score: 0, status: "graded", classId, subjectId, ...scope },
      { id: "exam", studentId: students[0].id, gradingSlot: "semester_1_exam", score: 12, status: "graded", classId, subjectId, ...scope },
      { id: "absent", studentId: students[1].id, gradingSlot: "period_1", score: null, status: "absent", classId, subjectId, ...scope },
    ];
    await exportTeacherGradesPdf({
      school: { id: schoolId, name: "École fictive de test", acronym: "E2E", ...scope },
      year: { id: schoolYearId, name: "2026-2027", schoolId },
      teacher: { id: teacherId, fullName: "Aline Test", ...scope },
      assignment: { id: "e2e-pdf-assignment", teacherId, classId, subjectId, ...scope },
      schoolClass: { id: classId, name: "4ème Humanité Littéraire", ...scope },
      subject: { id: subjectId, name: "Géographie", ...scope },
      students,
      entries,
    } as Parameters<typeof exportTeacherGradesPdf>[0]);
  });
  await expect(page.locator("[data-pdf-download]")).toHaveAttribute("aria-disabled", "false");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-pdf-download]").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("cotations-2026-2027-e2e-pdf-assignment.pdf");
  const pdfPath = testInfo.outputPath("fiche-cotation-fictive.pdf");
  await download.saveAs(pdfPath);
  const loadingTask = getDocument({ data: new Uint8Array(readFileSync(pdfPath)), disableFontFace: true });
  const pdf = await loadingTask.promise;
  expect(pdf.numPages).toBe(3);
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    expect(page.view[3] - page.view[1]).toBeGreaterThan(page.view[2] - page.view[0]);
  }
  await loadingTask.destroy();
});
