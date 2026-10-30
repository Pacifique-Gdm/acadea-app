import { expect, test } from "@playwright/test";
import { calls, feedbackTransport, mount, settle } from "./support/feedbackHarness";
import { fixture, students } from "./support/emulatorRecipe";

test("Study director: independent class saves, failure and retry", async ({ page, context }) => {
  await feedbackTransport(context, { "/src/modules/studies/studyService.ts": `export function setStudyClassVacation({item}) { return window.feedback.call(item.id); }` });
  const classes = [{ id: "class-a", name: "1ère A", vacation: "morning" }, { id: "class-b", name: "2ème B", vacation: "morning" }];
  const view = await mount(page, "/src/modules/studies/StudyPeriodsModule.tsx", "StudyPeriodsModule", {
    user: { id: "u", role: "study_director", schoolId: "s" }, school: { id: "s" }, year: { id: "y" },
    data: { classes, sourceClasses: classes, periods: [], attendanceSettings: undefined },
  });
  const selects = view.locator('select[aria-label^="Vacation de"]');
  await selects.nth(0).selectOption("afternoon"); await selects.nth(1).selectOption("afternoon");
  await expect(selects.nth(0)).toBeDisabled(); await expect(selects.nth(1)).toBeDisabled();
  await settle(page, "class-a");
  await expect(selects.nth(0)).toBeEnabled(); await expect(selects.nth(1)).toBeDisabled();
  await settle(page, "class-b", undefined, "Sauvegarde refusée (test)");
  await expect(view.getByRole("alert")).toContainText("Sauvegarde refusée");
  await expect(selects.nth(1)).toBeEnabled();
  await selects.nth(1).selectOption("afternoon");
  await settle(page, "class-b");
  expect(await calls(page, "class-b")).toBe(2);
  await expect(view.getByRole("alert")).toHaveCount(0);
});

test("Teacher documents: loading, error, retry, download and archive locks", async ({ page, context }) => {
  await feedbackTransport(context, {
    "/src/modules/teacher/teacherLearningService.ts": `
      export function subscribeTeacherLearning(u,s,y,t,next,error) { let active=true; window.feedback.call('list').then(v=>active&&next(v),e=>active&&error(e)); return ()=>{active=false}; }
      export function archivePedagogicalDocument() { return window.feedback.call('archive'); }`,
    "/src/modules/teacher/teacherDocumentStorage.ts": `export function downloadTeacherDocument() { return window.feedback.call('download'); }`,
  });
  const view = await mount(page, "/src/modules/teacher/TeacherDocumentsDrawer.tsx", "TeacherDocumentsDrawer", {
    user: { id: "u", role: "teacher", schoolId: "s" }, school: { id: "s" }, year: { id: "y" },
    data: { teacher: { id: "t" }, assignments: [], subjects: [], classes: [] },
  });
  await expect(view.getByRole("status")).toContainText("Chargement des documents");
  await expect(view.getByText("Aucun document pédagogique enregistré.")).toHaveCount(0);
  await settle(page, "list", undefined, "Lecture refusée (test)");
  await view.getByRole("button", { name: "Réessayer" }).click();
  await settle(page, "list", { progress: [], observations: [], documents: [{ id: "old-12345678", title: "Document fictif", category: "RESOURCE", storagePath: "test", originalFileName: "test.pdf", archived: false }] });
  const download = view.getByRole("button", { name: "Voir / télécharger" });
  await download.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  expect(await calls(page, "download")).toBe(1);
  await expect(view.getByRole("button", { name: "Traitement…" }).first()).toBeDisabled();
  await settle(page, "download", undefined, "Téléchargement refusé (test)");
  await expect(view.getByRole("alert")).toContainText("Téléchargement refusé");
  await download.click(); await settle(page, "download");
  await view.getByRole("button", { name: "Archiver", exact: true }).click();
  await expect(view.getByRole("button", { name: "Traitement…" }).last()).toBeDisabled();
  await settle(page, "archive", undefined, "Archivage refusé (test)");
  await expect(view.getByRole("alert")).toContainText("Archivage refusé");
  await view.getByRole("button", { name: "Archiver", exact: true }).click(); await settle(page, "archive");
  expect(await calls(page, "archive")).toBe(2);
});

for (const role of ["school_admin", "secretary"]) test(`${role}: student PDF awaits generation and restores retry after error`, async ({ browser }) => {
  const f = fixture();
  try {
    await f.seed([role]);
    const { page, context } = await f.session(browser, role, {}, undefined, (context) => feedbackTransport(context, {
      "/src/utils/studentPdf.ts": `export function exportStudentsPdf() { return window.feedback.call('student-pdf'); }`,
    }));
    try {
      await students(page);
      const button = page.getByRole("button", { name: "Exporter PDF", exact: true });
      await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
      await expect.poll(() => calls(page, "student-pdf")).toBe(1);
      await expect(page.getByRole("button", { name: "Chargement…", exact: true })).toBeDisabled();
      await settle(page, "student-pdf", undefined, "Génération PDF refusée (test)");
      await expect(page.getByText("Génération PDF refusée (test)")).toBeVisible();
      await expect(button).toBeEnabled();
      await button.click(); await settle(page, "student-pdf");
      await expect(button).toBeEnabled(); expect(await calls(page, "student-pdf")).toBe(2);
    } finally { await context.close(); }
  } finally { await f.cleanup(); }
});

for (const role of ["coordination_admin", "sub_coordination_admin"]) test(`${role}: measured pagination stability and no stale rows while loading`, async ({ page, context }) => {
  await feedbackTransport(context, { "/src/modules/coordination/useCoordinationControlPage.ts": `
    import React from '/node_modules/.vite/deps/react.js';
    const rows=Array.from({length:3},(_,i)=>({student:{id:'student-'+i,nom:'Ancien',prenom:'Fictif',schoolId:'s',schoolYearId:'y',className:'1ère'},balance:{expected:10,paid:0,remaining:10},progress:0,feeSummaries:[]}));
    export function useCoordinationControlPage() {
      const [loading,setLoading]=React.useState(false); window.feedback.setLoading=setLoading;
      return {rows:loading?[]:rows,loading,error:'',years:[],fees:[],classChoices:[],options:[],classChoicesReady:true,metadataReady:true,filterKey:'fixed',selectedYearId:'',status:'all',option:'',pageIndex:0,hasNext:true,filters:{},amountFilter:{},setSelectedYearId(){},setStatus(){},setOption(){},previous(){},next(){setLoading(true)}};
    }` });
  const view = await mount(page, "/src/modules/coordination/CoordinationControl.tsx", "CoordinationControl", {
    user: { id: "u", role }, coordination: { id: "c", name: "Fictive" }, schools: [{ id: "s", name: "Fictive", currency: "CDF" }], selectedSchoolId: "s", refreshToken: 0,
  });
  await expect(view.getByText("Ancien Fictif").first()).toBeVisible();
  // Two frames let the browser measure the initial results and deliver ResizeObserver.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const nav = view.getByRole("navigation", { name: "Pagination du contrôle" });
  const position = () => nav.evaluate(element => element.getBoundingClientRect().top + window.scrollY);
  const before = await position();
  await view.getByRole("button", { name: "Suivante" }).click();
  await expect(view.getByRole("status")).toBeVisible();
  await expect(view.getByText("Ancien Fictif")).toHaveCount(0);
  const during = await position();
  await page.evaluate(() => (window as unknown as { feedback: { setLoading: (value: boolean) => void } }).feedback.setLoading(false));
  await expect(view.getByText("Ancien Fictif").first()).toBeVisible();
  const after = await position();
  expect(Math.abs(during - before)).toBeLessThanOrEqual(1);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  await test.info().attach(`${role}-layout-measurements`, { body: JSON.stringify({ before, during, after, unit: "CSS px", viewport: page.viewportSize() }), contentType: "application/json" });
});

test("generic saving notice reflects acknowledgement, failure and retry", async ({ page, context }) => {
  await feedbackTransport(context, {});
  const view = await mount(page, "/src/components/layout/PersistenceNotice.tsx", "PersistenceNotice", {});
  const start = () => page.evaluate(async () => {
    const path = "/src/services/persistenceStatus.ts";
    const { trackPersistence } = await import(path);
    void trackPersistence(() => (window as unknown as { feedback: { call: (key: string) => Promise<unknown> } }).feedback.call("save"));
  });
  await start(); await expect(view.getByRole("status")).toContainText("Enregistrement en cours");
  await settle(page, "save", undefined, "refused");
  await expect(view.getByRole("alert")).toContainText("Échec");
  await start(); await settle(page, "save", true);
  await expect(view.getByRole("status")).toContainText("Enregistré sur le serveur");
});

test("offline panel: pending reads are not empty, failed synchronization retains drafts", async ({ page, context }) => {
  await feedbackTransport(context, {
    "/src/services/offlineQueue.ts": `export function listOfflineOperations() { return window.feedback.call('queue-list'); }`,
    "/src/services/offlineSync.ts": `export function syncOfflineOperations() { return window.feedback.call('queue-sync'); }`,
  });
  const view = await mount(page, "/src/components/offline/OfflineQueuePanel.tsx", "OfflineQueuePanel", {
    scope: { userId: "u", schoolId: "s", schoolYearId: "y" }, role: "teacher", autoSync: true,
  });
  await view.getByRole("button", { name: /Opérations hors connexion/ }).click();
  await expect(view.getByRole("status")).toHaveText("Lecture des opérations locales…");
  await expect(view.getByText(/Aucune opération locale/)).toHaveCount(0);
  await settle(page, "queue-list", [{ id: "historical-id", kind: "grade", status: "CONFLICT", createdAt: "2026-10-29T00:00:00Z" }]);
  await expect(view.getByText("Conflit — intervention nécessaire", { exact: true })).toBeVisible();
  await settle(page, "queue-sync", undefined, "Network unavailable (test)");
  await expect(view.getByRole("alert")).toContainText("Network unavailable (test)");
  await expect(view.getByText("Conflit — intervention nécessaire", { exact: true })).toBeVisible();
  await view.getByRole("button", { name: "Réessayer la synchronisation" }).click();
  await expect(view.getByRole("button", { name: "Synchronisation…", exact: true })).toBeDisabled();
  await settle(page, "queue-sync");
  await expect(view.getByRole("alert")).toHaveCount(0);
  // A successful transport without a server receipt must not invent confirmation.
  await expect(view.getByText("Conflit — intervention nécessaire", { exact: true })).toBeVisible();
});
