import { expect, test } from "@playwright/test";
import { fixture } from "./support/emulatorRecipe";

const roles = ["super_admin", "school_admin", "secretary", "study_director", "discipline_director", "teacher", "cashier", "parent", "coordination_admin", "sub_coordination_admin"];

test("ten roles retain authenticated access and responsive menus", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = fixture();
  try {
    await f.seed(roles);
    const coordinationId = f.tag + "-coord", subCoordinationId = f.tag + "-sub", parentId = f.tag + "-parent-profile";
    await f.put(`coordinations/${coordinationId}`, { id: coordinationId, name: "Coordination fictive", status: "active" });
    await f.put(`subCoordinations/${subCoordinationId}`, { id: subCoordinationId, coordinationId, status: "active", active: true, coordinatorUserId: f.tag + "-sub_coordination_admin" });
    await f.put(`coordinationSchools/${coordinationId}__${f.school}`, { coordinationId, schoolId: f.school, active: true });
    await f.put(`subCoordinationSchools/${subCoordinationId}__${f.school}`, { coordinationId, subCoordinationId, schoolId: f.school, active: true });
    await f.put(`parents/${parentId}`, { id: parentId, schoolId: f.school, userId: f.tag + "-parent", name: "Parent fictif", studentIds: [], active: true });
    await f.put(`teachers/${f.tag}-teacher-profile`, { id: f.tag + "-teacher-profile", schoolId: f.school, schoolYearId: f.year, userId: f.tag + "-teacher", name: "Enseignant fictif", active: true, status: "active" });
    for (const role of ["coordination_admin", "sub_coordination_admin", "parent"]) {
      const extra = role === "parent" ? { parentId } : { coordinationId, ...(role === "sub_coordination_admin" ? { subCoordinationId } : {}) };
      await f.auth.setCustomUserClaims(f.tag + "-" + role, { role, schoolId: f.school, ...extra });
      await f.db.doc("users/" + f.tag + "-" + role).update(extra);
    }
    for (const role of roles) {
      const { page, context } = await f.session(browser, role, {});
      try {
        await expect(page.getByRole("button", { name: "Menu", exact: true }).last()).toBeVisible();
        await page.getByRole("button", { name: "Menu", exact: true }).last().click();
        await expect(page.getByRole("button", { name: /Déconnexion/ }).first()).toBeVisible();
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        }
      } finally { await context.close(); }
    }
  } finally { await f.cleanup(); }
});

test("real discipline export component locks double clicks and exposes failure/retry", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js", domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const componentPath = "/src/components/discipline/DisciplineStatus.tsx";
    const React = await import(reactPath), { createRoot } = await import(domPath), { DisciplineStatus } = await import(componentPath);
    const container = document.createElement("div"); container.id = "fluidity-test"; document.body.appendChild(container);
    const state = { calls: 0, reject: () => {} };
    Object.assign(window, { fluidityTest: state });
    createRoot(container).render(React.createElement(DisciplineStatus, { sanctions: [], students: [], onNewSanction() {}, onOpenStudent() {},
      onExportPdf: () => { state.calls++; return new Promise<void>((_resolve, reject) => { state.reject = () => reject(new Error("PDF fictif indisponible")); }); },
    }));
  });
  const container = page.locator("#fluidity-test");
  const button = container.getByRole("button", { name: "Exporter PDF" });
  await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(container.getByRole("button", { name: "Préparation du PDF…" })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { fluidityTest: { calls: number } }).fluidityTest.calls)).toBe(1);
  await page.evaluate(() => (window as unknown as { fluidityTest: { reject: () => void } }).fluidityTest.reject());
  await expect(container.getByRole("alert")).toHaveText("PDF fictif indisponible");
  await expect(button).toBeEnabled();
  await button.click();
  expect(await page.evaluate(() => (window as unknown as { fluidityTest: { calls: number } }).fluidityTest.calls)).toBe(2);
  await page.evaluate(() => (window as unknown as { fluidityTest: { reject: () => void } }).fluidityTest.reject());
});
