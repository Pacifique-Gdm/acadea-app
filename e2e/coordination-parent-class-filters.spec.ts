import { expect, test, type Page } from "@playwright/test";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";
import { coordinationMissionFixture } from "./support/coordinationMissionFixture";

async function seedParentClasses(fixture: Awaited<ReturnType<typeof coordinationMissionFixture>>) {
  const { prefix, db, schoolId, coordinationId, subCoordinationId, yearId } = fixture;
  const schools = { a: schoolId, b: `${prefix}-school-b`, c: `${prefix}-school-c`, d: `${prefix}-school-d` };
  const years = { a: yearId, b: `${prefix}-year-b`, c: `${prefix}-year-c`, d: `${prefix}-year-d`, oldD: `${prefix}-year-d-old` };
  const parents = { a: `${prefix}-parent-a`, b: `${prefix}-parent-b`, c: `${prefix}-parent-c`, d: `${prefix}-parent-d` };
  const batch = db.batch();
  batch.update(db.doc(`schools/${schools.a}`), { educationLevels: ["Primaire", "CTEB"] });
  for (const [letter, name, levels, options] of [
    ["b", "École E2E CTEB", ["CTEB"], []],
    ["c", "École E2E Humanité 2", ["Secondaire"], ["Sciences", "Littéraire", "Commerciale"]],
    ["d", "École E2E Humanité 1", ["Secondaire"], ["Sciences", "Littéraire"]],
  ] as const) {
    const schoolId = schools[letter];
    batch.set(db.doc(`schools/${schoolId}`), { id: schoolId, name, schoolType: "Mixte", educationLevels: levels, schoolOptions: options,
      activeSchoolYearId: years[letter], activeCoordinationId: coordinationId, status: "active", subscriptionPlan: "Premium", subscriptionStatus: "active", subscriptionAmount: 0, currency: "USD" });
    batch.set(db.doc(`coordinationSchools/${coordinationId}__${schoolId}`), { id: `${coordinationId}__${schoolId}`, coordinationId, schoolId, active: true });
    batch.set(db.doc(`subCoordinationSchools/${subCoordinationId}__${schoolId}`), { id: `${subCoordinationId}__${schoolId}`, coordinationId, subCoordinationId, schoolId, active: true });
    batch.set(db.doc(`schoolYears/${years[letter]}`), { id: years[letter], schoolId, name: "2027-2028", status: "active", startsAt: "2027-09-01", endsAt: "2028-07-31", currency: "USD" });
  }
  batch.set(db.doc(`schoolYears/${years.oldD}`), { id: years.oldD, schoolId: schools.d, name: "2026-2027", status: "archived", startsAt: "2026-09-01", endsAt: "2027-07-31", currency: "USD" });
  for (const [letter, name, section] of [["a", "1ère Primaire", "Primaire"], ["b", "7ème CTEB", "CTEB"], ["c", "2ème Humanité", "Secondaire"], ["d", "1ère Humanité", "Secondaire"]] as const) {
    batch.set(db.doc(`classes/${parents[letter]}`), { id: parents[letter], schoolId: schools[letter], schoolYearId: years[letter], name, section, active: true });
  }
  for (const [school, parent, base, options] of [
    ["c", parents.c, "2ème", ["Sciences", "Littéraire", "Commerciale"]],
    ["d", parents.d, "1ère", ["Sciences", "Littéraire"]],
  ] as const) for (const option of options) {
    const key = `${parent}::${option.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()}`;
    batch.set(db.doc(`classes/${key}`), { id: key, schoolId: schools[school], schoolYearId: years[school], name: `${base} ${option}`,
      parentClassId: parent, option, classOptionKey: key, section: "Secondaire", active: true });
  }
  // Historical materialization: the ID identifies the parent, but option metadata is absent.
  batch.set(db.doc(`classes/${parents.d}::scientifique`), { id: `${parents.d}::scientifique`, schoolId: schools.d, schoolYearId: years.d,
    name: "1ère Scientifique", active: true });
  batch.set(db.doc(`classes/${prefix}-old-d`), { id: `${prefix}-old-d`, schoolId: schools.d, schoolYearId: years.oldD, name: "3ème Humanité", section: "Secondaire", active: true });
  function addStudent(id: string, schoolId: string, schoolYearId: string, className: string, option = "", classId = "") {
    batch.set(db.doc(`students/${id}`), studentForPersistence({ id, schoolId, schoolYearId, matricule: id, nom: id, postnom: "E2E", prenom: "Filtre",
      sexe: "F", birthDate: "2013-06-01", status: "ACTIVE", section: /Primaire/.test(className) ? "Primaire" : /CTEB/.test(className) ? "CTEB" : "Secondaire",
      className, ...(option ? { option } : {}), ...(classId ? { classId } : {}) }));
  }
  addStudent(`${prefix}-a-student`, schools.a, years.a, "1ère Primaire", "", parents.a);
  addStudent(`${prefix}-b-student`, schools.b, years.b, "7ème CTEB", "", parents.b);
  for (const option of ["Sciences", "Littéraire", "Commerciale"]) addStudent(`${prefix}-c-${option}`, schools.c, years.c, "2ème Humanité", option, parents.c);
  for (let index = 0; index < 58; index++) {
    const science = index < 29;
    addStudent(`${prefix}-d-${String(index).padStart(2, "0")}`, schools.d, years.d,
      index === 28 ? "1ère Scientifique" : "1ère Humanité", index === 28 ? "" : science ? "Sciences" : "Littéraire", parents.d);
  }
  addStudent(`${prefix}-d-old-student`, schools.d, years.oldD, "3ème Humanité");
  await batch.commit();
  return { schools, years };
}

async function displayedIds(page: Page, tab: string, prefix: string) {
  const cards = tab === "Contrôle" ? page.locator("article") : page.locator("table tbody tr");
  const text = (await cards.allTextContents()).join(" ");
  return [...new Set([...text.matchAll(new RegExp(`${prefix}-d-\\d{2}`, "g"))].map((match) => match[0]))];
}

test("Coordination et Sous-coordination : parents distincts, options et pagination réelle", async ({ browser, request }) => {
  test.setTimeout(1_200_000);
  const expectedSha = process.env.E2E_EXPECTED_SHA;
  expect(expectedSha).toMatch(/^[a-f0-9]{40}$/);
  const version = await request.get("/version.json");
  expect(version.status()).toBe(200);
  expect(await version.text()).toContain(expectedSha!);
  const fixture = await coordinationMissionFixture();
  const contexts = [];
  try {
    await fixture.seed();
    const { schools, years } = await seedParentClasses(fixture);
    for (const role of ["coordination_admin", "sub_coordination_admin"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      contexts.push(context);
      const page = await context.newPage();
      await fixture.login(page, role);
      for (const tab of ["Élèves", "Contrôle"]) {
        await page.getByRole("button", { name: tab, exact: true }).last().click();
        const school = page.getByLabel("Filtrer par école", { exact: true });
        const year = page.getByLabel("Année scolaire", { exact: true });
        const parent = page.getByLabel("Classe", { exact: true });
        const option = page.getByLabel("Option", { exact: true });
        await school.selectOption("");
        await expect(parent).toBeEnabled({ timeout: 60_000 });
        const labels = await parent.locator("option").allTextContents();
        expect(labels).toEqual(expect.arrayContaining(["1ère Primaire — École E2E Finance Coordination", "7ème CTEB — École E2E CTEB", "2ème Humanité — École E2E Humanité 2", "1ère Humanité — École E2E Humanité 1"]));
        expect(labels.join(" ")).not.toMatch(/1ère Sciences|1ère Littéraire|1ère Scientifique|2ème Sciences|2ème Littéraire/);
        await school.selectOption(schools.d);
        await expect.poll(async () => (await parent.locator("option").allTextContents()).join(" "), { timeout: 60_000 }).toContain("1ère Humanité");
        await parent.selectOption(`${schools.d}::1ère Humanité`);
        await expect.poll(async () => (await option.locator("option").allTextContents()).join(" ")).toContain("Sciences");
        expect((await option.locator("option").allTextContents()).join(" ")).toContain("Littéraire");
        expect((await option.locator("option").allTextContents()).join(" ")).not.toContain("Commerciale");
        const pagination = page.getByRole("navigation", { name: tab === "Contrôle" ? "Pagination du contrôle" : "Pagination des élèves" });
        await expect.poll(async () => (await displayedIds(page, tab, fixture.prefix)).length, { timeout: 90_000 }).toBe(50);
        const first = await displayedIds(page, tab, fixture.prefix);
        expect(new Set(first).size).toBe(50);
        if (role === "coordination_admin" && tab === "Élèves") {
          await expect(pagination.getByRole("button", { name: "Suivante" })).toBeEnabled();
          await pagination.getByRole("button", { name: "Suivante" }).click();
          await expect.poll(async () => (await displayedIds(page, tab, fixture.prefix)).length).toBe(8);
          const second = await displayedIds(page, tab, fixture.prefix);
          expect(new Set([...first, ...second]).size).toBe(58);
          await pagination.getByRole("button", { name: "Précédente" }).click();
          await expect.poll(async () => (await displayedIds(page, tab, fixture.prefix)).length).toBe(50);
        }
        await option.selectOption("Sciences");
        await expect.poll(async () => (await displayedIds(page, tab, fixture.prefix)).length, { timeout: 90_000 }).toBe(29);
        expect((await displayedIds(page, tab, fixture.prefix)).join(" ")).toContain(`${fixture.prefix}-d-28`);
        await option.selectOption("Littéraire");
        await expect.poll(async () => (await displayedIds(page, tab, fixture.prefix)).length, { timeout: 90_000 }).toBe(29);
        expect((await displayedIds(page, tab, fixture.prefix)).join(" ")).not.toContain(`${fixture.prefix}-d-28`);
        await option.selectOption("");
        await expect.poll(async () => (await displayedIds(page, tab, fixture.prefix)).length).toBe(50);
        await school.selectOption(schools.c);
        await expect(parent).toHaveValue("");
        await expect(option).toHaveValue("");
        await parent.selectOption(`${schools.c}::2ème Humanité`);
        await expect.poll(async () => (await option.locator("option").allTextContents()).join(" ")).toContain("Commerciale");
        await option.selectOption("Commerciale");
        await school.selectOption(schools.d);
        await year.selectOption(years.oldD);
        await expect(parent).toHaveValue("");
        await expect(option).toHaveValue("");
        await expect.poll(async () => (await parent.locator("option").allTextContents()).join(" ")).toContain("3ème Humanité");
        expect((await parent.locator("option").allTextContents()).join(" ")).not.toContain("1ère Humanité");
        for (const width of [1440, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
          await expect(parent).toBeVisible();
          await expect(option).toBeVisible();
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        console.log(JSON.stringify({ role, tab, parentUnion: 58, sciences: 29, literature: 29, responsive: [1440, 768, 390], result: "PASS" }));
      }
    }
  } finally {
    for (const context of contexts) await context.close();
    await fixture.cleanup();
    const independent = await coordinationMissionFixture(fixture.prefix);
    try {
      const residues = await independent.scanResidues();
      console.log(JSON.stringify({ independentResidueScan: residues }));
      expect(residues).toEqual({ firestore: 0, auth: 0, storage: 0 });
    } finally { await independent.close(); }
  }
});
