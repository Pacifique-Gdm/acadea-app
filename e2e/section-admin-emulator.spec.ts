import { expect, test, type BrowserContext } from "@playwright/test";
import provision from "../api/provision-school-account.js";
import financial from "../api/manage-financial-transaction.js";
import recipients from "../api/message-recipients.js";
import send from "../api/send-school-message.js";
import { fixture, invoke } from "./support/emulatorRecipe";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";

test("B08 : connexions normales, cinq onglets et refus des trois profils", async ({ browser }) => {
  test.setTimeout(240_000);
  const f = fixture(), contexts: BrowserContext[] = [];
  const roles = ["kindergarten_admin", "primary_admin", "studies_prefect"];
  try {
    await f.seed(roles);
    const sections = ["Maternelle", "Primaire", "CTEB", "Secondaire"];
    await f.db.doc(`schools/${f.school}`).update({ educationLevels: sections });
    for (const [index, section] of sections.entries()) {
      const classId = `${f.tag}-class-${index}`, studentId = `${f.tag}-student-${index}`;
      await f.put(`classes/${classId}`, { id: classId, schoolId: f.school, schoolYearId: f.year, name: `Classe ${section}`, section, active: true });
      await f.put(`students/${studentId}`, studentForPersistence({ id: studentId, schoolId: f.school, schoolYearId: f.year,
        classId, className: `Classe ${section}`, section, nom: `FICTIF${index}`, postnom: "TEST", prenom: "Élève",
        matricule: `B08-${index}`, sexe: "F", birthDate: "2015-01-01", status: "ACTIVE" }));
    }
    for (const role of roles) {
      const uid = `${f.tag}-${role}`;
      const authorized = role === "kindergarten_admin" ? ["Maternelle"] : role === "primary_admin" ? ["Primaire"] : ["CTEB", "Secondaire"];
      await f.db.doc(`users/${uid}`).update({ sectionIds: authorized });
      const token = await f.token(role);
      expect((await invoke(provision, token, { action: "load-section-school-bootstrap" })).status).toBe(200);
      expect((await invoke(provision, token, { action: "create-parent", schoolId: f.school })).status).toBe(403);
      expect((await invoke(provision, token, { action: "load-section-dashboard", schoolYearId: `${f.tag}-other-year` })).status).toBe(403);
      const { page, context } = await f.session(browser, role, {
        "/api/provision-school-account": provision,
        "/api/manage-financial-transaction": financial,
        "/api/message-recipients": recipients,
        "/api/send-school-message": send,
      });
      contexts.push(context);
      for (const tab of ["Dashboard", "Élèves", "Contrôle", "Message", "Menu"]) {
        const button = page.getByRole("button", { name: tab, exact: true }).last();
        await expect(button).toBeVisible();
        await button.click();
        if (tab === "Élèves") {
          for (const [index, section] of sections.entries()) {
            const row = page.getByRole("row").filter({ hasText: `FICTIF${index}` });
            if (authorized.includes(section)) await expect(row).toBeVisible();
            else await expect(row).toHaveCount(0);
          }
        }
        await expect(page.getByText("Accès refusé", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Créer un utilisateur", exact: true })).toHaveCount(0);
      }
      await expect(page.getByText("Parents / Tuteurs", { exact: true })).toHaveCount(0);
      await f.db.doc(`users/${uid}`).update({ active: false, status: "inactive" });
      expect((await invoke(provision, token, { action: "load-section-school-bootstrap" })).status).toBe(403);
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
      await context.close();
      contexts.splice(contexts.indexOf(context), 1);
    }
  } finally {
    for (const context of contexts) await context.close();
    await f.cleanup();
  }
});
