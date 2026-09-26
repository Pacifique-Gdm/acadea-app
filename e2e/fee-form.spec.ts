import { devices, expect, test, webkit, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { studentForPersistence } from "../src/utils/studentYearTransition.js";

test.setTimeout(300_000);
test("Types de frais — persistance, confirmations, classement et responsive isolés", async ({ page, browser, baseURL }) => {
  expect(baseURL).toBe("https://acadea-staging.vercel.app");
  const expectedSHA = process.env.E2E_EXPECTED_SHA;
  if (!expectedSHA) throw new Error("SHA E2E attendu obligatoire.");
  const version = await page.request.get(`${baseURL}/version.json`);
  expect((await version.json()).version).toBe(expectedSHA);
  const config = parse(readFileSync(".env.staging.local"));
  const credential = JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
  expect(credential.project_id).toBe("acadea-staging");
  const app = initializeApp({ credential: cert(credential), projectId: "acadea-staging", storageBucket: "acadea-staging.firebasestorage.app" }, "fee-form-e2e");
  const db = getFirestore(app);
  const auth = getAuth(app);
  const prefix = `e2e-fee-form-${Date.now()}`;
  const schools = [`${prefix}-a`, `${prefix}-b`];
  const uids: string[] = [];
  const accounts: { email: string; password: string }[] = [];
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("pageerror"));
  const fees = (index: number) => db.collection("feeTypes").where("schoolId", "==", schools[index]).get();
  async function login(target: Page, index: number) {
    await target.goto("/login");
    try {
      await target.getByPlaceholder("email@ecole.com").fill(accounts[index].email);
      await target.getByPlaceholder("Votre mot de passe").fill(accounts[index].password);
      await target.getByRole("button", { name: "Se connecter", exact: true }).click();
    } catch { throw new Error("Saisie E2E impossible, identifiants non affichés."); }
    await expect(target).not.toHaveURL(/\/login/, { timeout: 60000 });
    await target.getByRole("button", { name: "Menu", exact: true }).click();
    await target.getByRole("button", { name: /Types de frais/ }).click();
  }
  const drawer = () => page.getByRole("dialog", { name: "Types de frais", exact: true });
  async function reopen() {
    await page.getByRole("button", { name: "Fermer Types de frais", exact: true }).click();
    await page.getByRole("button", { name: /Types de frais/ }).click();
  }
  async function layout(width: number) {
    await page.setViewportSize({ width, height: 900 });
    const editor = drawer().getByTestId("fee-editor");
    const boxes = await editor.locator(":scope > *").evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
    expect(await drawer().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const buttons = editor.getByTestId("fee-editor-actions").getByRole("button");
    if (await buttons.count() === 2) {
      const a = await buttons.nth(0).boundingBox(); const b = await buttons.nth(1).boundingBox();
      const sameFrame = await buttons.evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { y: r.y, width: r.width }; }));
      console.log(JSON.stringify({ phase: "edit-buttons", width, sequentialDeltaY: Math.abs(a!.y - b!.y), sameFrameDeltaY: Math.abs(sameFrame[0].y - sameFrame[1].y), sameFrameWidths: sameFrame.map(r => r.width) }));
      expect(Math.abs(sameFrame[0].y - sameFrame[1].y)).toBeLessThan(1);
      expect(Math.abs(sameFrame[0].width - sameFrame[1].width)).toBeLessThan(1);
    }
    console.log(JSON.stringify({ phase: "layout", width, pass: true }));
  }
  try {
    for (let i = 0; i < schools.length; i++) {
      const schoolId = schools[i]; const yearId = `${schoolId}__2027-2028`;
      const email = `${schoolId}@example.test`; const password = `E2e!${randomBytes(20).toString("hex")}`;
      const user = await auth.createUser({ uid: `${schoolId}-admin`, email, password });
      uids.push(user.uid); accounts.push({ email, password });
      await auth.setCustomUserClaims(user.uid, { role: "school_admin", schoolId });
      await db.doc(`users/${user.uid}`).set({ id: user.uid, name: "Administrateur E2E Frais", email, role: "school_admin", schoolId, status: "active", active: true, activeSchoolYearId: yearId });
      await db.doc(`schools/${schoolId}`).set({ id: schoolId, name: `École E2E Frais ${i ? "B" : "A"}`, schoolType: "Mixte", educationLevels: i ? ["Maternelle", "Primaire", "Secondaire"] : ["Primaire", "CTEB"], schoolOptions: ["Littéraire", "Sciences"], activeSchoolYearId: yearId, status: "active", subscriptionPlan: "Premium", subscriptionStatus: "active", subscriptionAmount: 0, address: "Fixture Staging", phone: "", email, mainAdminId: user.uid });
      await db.doc(`schoolYears/${yearId}`).set({ id: yearId, schoolId, name: "2027-2028", startsAt: "2027-09-01", endsAt: "2028-07-31", status: "active", currency: "CDF" });
      const classes = i ? ["Maternelle 1", "1ère Primaire", "1ère Humanité"] : ["1ère Primaire", "6ème Primaire", "7ème CTEB", "8ème CTEB"];
      for (const [j, className] of classes.entries()) {
        const id = `${schoolId}-student-${j}`;
        await db.doc(`students/${id}`).set(studentForPersistence({ id, schoolId, schoolYearId: yearId, matricule: id, nom: "E2E", postnom: "Frais", prenom: `${j}`, sexe: "F", className, birthDate: "2014-08-15", status: "ACTIVE", ...(className.includes("Humanité") ? { option: "Littéraire" } : {}) }));
        const feeId = `${schoolId}-seed-${j}`;
        await db.doc(`feeTypes/${feeId}`).set({ id: feeId, schoolId, schoolYearId: yearId, name: "Fourniture", amount: 10, className, ...(className.includes("Humanité") ? { classOptionKey: "1ère Humanité::option::Littéraire" } : {}) });
      }
      const legacyId = `${schoolId}-legacy`;
      await db.doc(`feeTypes/${legacyId}`).set({ id: legacyId, schoolId, schoolYearId: yearId, name: "Legacy E2E", amount: 3 });
    }
    await login(page, 0);
    for (const width of [1440, 768, 390]) await layout(width);
    await expect(drawer().getByTestId("fee-groups").locator("h3")).toHaveText(["Primaire", "CTEB", "Toutes les classes / références historiques"]);
    await expect(drawer().getByTestId("fee-groups").locator("h4")).toHaveText(["1ère Primaire", "6ème Primaire", "7ème CTEB", "8ème CTEB"]);
    await drawer().getByLabel("Frais", { exact: true }).selectOption("Minerval");
    await drawer().getByText("1ère Primaire", { exact: true }).first().locator("..").getByRole("checkbox").check();
    await drawer().getByText("7ème CTEB", { exact: true }).first().locator("..").getByRole("checkbox").check();
    await drawer().getByRole("spinbutton").fill("27");
    const before = (await fees(0)).size;
    await drawer().getByRole("button", { name: "Enregistrer", exact: true }).click();
    const addDialog = page.getByRole("dialog", { name: "Ajouter le type de frais", exact: true });
    expect((await fees(0)).size).toBe(before);
    await expect(addDialog.getByPlaceholder("AJOUTER CE FRAIS")).toHaveValue("");
    await addDialog.getByPlaceholder("AJOUTER CE FRAIS").pressSequentially("AJOUTER CE FRAIS");
    await addDialog.getByRole("button", { name: "Confirmer l'ajout", exact: true }).click();
    await expect(addDialog).toHaveCount(0);
    await expect.poll(async () => (await fees(0)).size).toBe(before + 2);
    const created = (await fees(0)).docs.filter(d => d.data().name === "Minerval");
    const id = created[0].id;
    const row = () => drawer().locator(`[data-fee-id="${id}"]`);
    await row().getByRole("button", { name: "Modifier", exact: true }).click();
    for (const width of [1440, 768, 390]) await layout(width);
    await drawer().getByRole("spinbutton").fill("39");
    await drawer().getByTestId("fee-editor-actions").getByRole("button", { name: "Enregistrer", exact: true }).click();
    const editDialog = page.getByRole("dialog", { name: "Modifier le type de frais", exact: true });
    const confirm = editDialog.getByPlaceholder("MODIFIER CE FRAIS");
    await expect(confirm).toHaveValue("");
    expect((await db.doc(`feeTypes/${id}`).get()).data()!.amount).toBe(27);
    for (const wrong of ["modifier ce frais", "MODIFIER CE FRAI", "MODIFIER CE FRAIS "]) {
      await confirm.fill(wrong);
      await expect(editDialog.getByRole("button", { name: "Confirmer la modification", exact: true })).toBeDisabled();
      expect((await db.doc(`feeTypes/${id}`).get()).data()!.amount).toBe(27);
    }
    await editDialog.getByRole("button", { name: "Annuler", exact: true }).click();
    await drawer().getByTestId("fee-editor-actions").getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(confirm).toHaveValue("");
    await confirm.pressSequentially("MODIFIER CE FRAIS");
    await editDialog.getByRole("button", { name: "Confirmer la modification", exact: true }).click();
    await expect(editDialog).toHaveCount(0);
    expect((await db.doc(`feeTypes/${id}`).get()).data()!.amount).toBe(39);
    await reopen();
    await expect(row()).toContainText("39");
    await row().getByRole("button", { name: "Modifier", exact: true }).click();
    await drawer().getByRole("spinbutton").fill("99");
    await drawer().getByTestId("fee-editor-actions").getByRole("button", { name: "Annuler", exact: true }).click();
    await expect(drawer().getByRole("spinbutton")).toHaveValue("100");
    expect((await db.doc(`feeTypes/${id}`).get()).data()!.amount).toBe(39);
    await page.reload();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: /Types de frais/ }).click();
    await expect(row()).toContainText("39");
    await page.getByRole("button", { name: "Fermer Types de frais", exact: true }).click();
    await page.getByRole("button", { name: /Déconnexion|Se déconnecter/, exact: true }).click();
    await login(page, 0);
    await expect(row()).toContainText("39");
    await row().getByRole("button", { name: "Supprimer", exact: true }).click();
    const deletion = page.getByRole("dialog", { name: "Supprimer le frais", exact: true });
    await deletion.getByPlaceholder("SUPPRIMER LE FRAIS").pressSequentially("SUPPRIMER LE FRAIS");
    await deletion.getByRole("button", { name: "Supprimer", exact: true }).click();
    await expect(deletion).toHaveCount(0);
    expect((await db.doc(`feeTypes/${id}`).get()).exists).toBe(false);
    await reopen(); await expect(row()).toHaveCount(0);
    const context = await browser.newContext({ baseURL });
    try {
      const second = await context.newPage(); await login(second, 1);
      const groups = second.getByTestId("fee-groups");
      await expect(groups.locator("h3")).toHaveText(["Maternelle", "Primaire", "Secondaire", "Toutes les classes / références historiques"]);
      await expect(groups).toContainText("1ère Humanité");
      await expect(groups).toContainText("Littéraire");
      expect(await groups.locator(`[data-fee-id^="${schools[0]}"]`).count()).toBe(0);
    } finally { await context.close(); }
    const iphone = await webkit.launch({ headless: true });
    try {
      const mobile = await iphone.newContext({ ...devices["iPhone 13"], baseURL });
      const target = await mobile.newPage();
      await login(target, 0);
      const editor = target.getByTestId("fee-editor");
      await target.locator(`[data-fee-id="${schools[0]}-seed-0"]`).getByRole("button", { name: "Modifier", exact: true }).click();
      const dimensions = await editor.evaluate(el => ({
        columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
        buttons: [...el.querySelectorAll('[data-testid="fee-editor-actions"] button')].map(b => { const r = b.getBoundingClientRect(); return { y: r.y, width: r.width }; }),
      }));
      expect(dimensions.columns).toBe(1);
      expect(dimensions.buttons).toHaveLength(2);
      expect(Math.abs(dimensions.buttons[0].y - dimensions.buttons[1].y)).toBeLessThan(1);
      expect(Math.abs(dimensions.buttons[0].width - dimensions.buttons[1].width)).toBeLessThan(1);
      expect(await target.getByRole("dialog", { name: "Types de frais", exact: true }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await editor.getByRole("button", { name: "Annuler", exact: true }).click();
      console.log("IPHONE_WEBKIT_FEE_LAYOUT_PASS");
    } finally { await iphone.close(); }
    expect(errors).toEqual([]);
    console.log("FEE_FORM_RUNTIME_PASS");
  } finally {
    // Independent scan of all root collections: remove only this isolated scope.
    const roots = await db.listCollections();
    let deleted = 0;
    for (const root of roots) {
      const ids = new Map<string, DocumentReference>();
      for (const schoolId of schools) {
        const scoped = await root.where("schoolId", "==", schoolId).get();
        scoped.docs.forEach(d => ids.set(d.id, d.ref));
      }
      const prefixed = await root.where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", prefix + "\uf8ff").get();
      prefixed.docs.forEach(d => ids.set(d.id, d.ref));
      for (const ref of ids.values()) { await ref.delete(); deleted++; }
    }
    for (const uid of uids) await auth.deleteUser(uid);
    let residues = 0;
    for (const root of await db.listCollections()) {
      for (const schoolId of schools) residues += (await root.where("schoolId", "==", schoolId).get()).size;
      residues += (await root.where(FieldPath.documentId(), ">=", prefix).where(FieldPath.documentId(), "<", prefix + "\uf8ff").get()).size;
    }
    let cursor: string | undefined; let authResidues = 0;
    do { const result = await auth.listUsers(1000, cursor); authResidues += result.users.filter(u => u.uid.startsWith(prefix)).length; cursor = result.pageToken; } while (cursor);
    const [storage] = await getStorage(app).bucket().getFiles({ prefix: `${prefix}/` });
    console.log(JSON.stringify({ cleanup: true, documentsDeleted: deleted, accountsDeleted: uids.length, firestoreResidues: residues, authResidues, storageResidues: storage.length }));
    await deleteApp(app);
    expect(residues).toBe(0); expect(authResidues).toBe(0); expect(storage.length).toBe(0);
  }
});
