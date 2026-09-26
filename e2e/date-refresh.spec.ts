import { expect, test, type Page } from "@playwright/test";

const roles = ["SCHOOL_ADMIN", "SECRETARY", "CASHIER", "STUDY_DIRECTOR", "DISCIPLINE", "TEACHER", "PARENT"] as const;
test.setTimeout(120_000);

async function login(page: Page, role: typeof roles[number]) {
  const email = process.env[`E2E_${role}_EMAIL`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  if (!email || !password) throw new Error(`Compte E2E Staging manquant : ${role}`);
  await page.goto("/login");
  try {
    await page.getByPlaceholder("email@ecole.com").fill(email);
    await page.getByPlaceholder("Votre mot de passe").fill(password);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  } catch {
    throw new Error(`Saisie de connexion E2E impossible : ${role}`);
  }
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
}

for (const role of roles) {
  test(`actualisation authentifiée ${role}`, async ({ page }) => {
    const refreshErrors: string[] = [];
    page.on("console", async (message) => {
      if (message.type() === "error" && message.text().includes("[Acadéa refresh]")) {
        const details = await message.args()[1]?.jsonValue();
        refreshErrors.push(JSON.stringify({ module: details?.module, errorCode: details?.errorCode, collectionPath: details?.collectionPath }));
      }
    });
    await login(page, role);
    let firestoreRequests = 0;
    let firestoreTargets = 0;
    page.on("request", (request) => {
      if (!request.url().startsWith("https://firestore.googleapis.com/")) return;
      firestoreRequests++;
      for (const value of new URLSearchParams(request.postData() ?? "").values()) {
        try {
          if (JSON.parse(value)?.addTarget) firestoreTargets++;
        } catch { /* Les paramètres de transport non JSON ne sont pas des requêtes de données. */ }
      }
    });
    const navigation = page.getByRole("button", { name: "Menu", exact: true });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const before = firestoreRequests;
      const targetsBefore = firestoreTargets;
      const refresh = page.getByRole("button", { name: "Actualiser", exact: true });
      await refresh.click();
      await expect.poll(() => firestoreRequests, { timeout: 30_000 }).toBeGreaterThan(before);
      await expect.poll(() => firestoreTargets, { timeout: 30_000 }).toBeGreaterThan(targetsBefore);
      await expect(refresh).toBeEnabled({ timeout: 30_000 });
      expect(refreshErrors, "échec technique réel d'actualisation").toEqual([]);
      const box = await refresh.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await navigation.click();
    const afterNavigation = firestoreRequests;
    await page.getByRole("button", { name: "Actualiser", exact: true }).click();
    await expect.poll(() => firestoreRequests, { timeout: 30_000 }).toBeGreaterThan(afterNavigation);
    await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
    expect(refreshErrors).toEqual([]);
    if (role === "SECRETARY") {
      const years = page.getByRole("combobox", { name: "Année scolaire", exact: true });
      const initial = await years.inputValue();
      const values = await years.locator("option").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      const other = values.find((value) => value !== initial);
      if (!other) throw new Error("Changement d'année non vérifiable : une seule année disponible pour le compte Secrétaire.");
      await years.selectOption(other);
      await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
      await page.getByRole("button", { name: "Actualiser", exact: true }).click();
      await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
      await years.selectOption(initial);
      await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
      expect(refreshErrors).toEqual([]);
    }
    await page.getByRole("button", { name: role === "PARENT" ? "Enfants" : "Dashboard", exact: true }).click();
    const beforeRapidClicks = firestoreTargets;
    await page.getByRole("button", { name: "Actualiser", exact: true }).dblclick();
    await expect.poll(() => firestoreTargets, { timeout: 30_000 }).toBeGreaterThan(beforeRapidClicks);
    await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
    expect(refreshErrors).toEqual([]);
    await page.reload();
    await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole("button", { name: "Actualiser", exact: true }).click();
    await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
    expect(refreshErrors).toEqual([]);
    await navigation.click();
    await page.getByRole("button", { name: /Déconnexion|Se déconnecter/, exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await login(page, role);
    const afterLogin = firestoreTargets;
    await page.getByRole("button", { name: "Actualiser", exact: true }).click();
    await expect.poll(() => firestoreTargets, { timeout: 30_000 }).toBeGreaterThan(afterLogin);
    await expect(page.getByRole("button", { name: "Actualiser", exact: true })).toBeEnabled({ timeout: 30_000 });
    expect(refreshErrors).toEqual([]);
  });
}

for (const role of ["SCHOOL_ADMIN", "SECRETARY"] as const) {
  test(`date guidée authentifiée ${role}`, async ({ page }) => {
    await login(page, role);
    await page.getByRole("button", { name: "Élèves", exact: true }).click();
    await page.getByRole("button", { name: "Ajouter un élève", exact: true }).click();
    const date = page.getByLabel("Date de naissance", { exact: true });
    await date.pressSequentially("15082014");
    await expect(date).toHaveValue("15/08/2014");
    await date.press("Space");
    await date.press("a");
    await date.press("/");
    await expect(date).toHaveValue("15/08/2014");
    await date.press("Backspace");
    await expect(date).toHaveValue("15/08/201");
    await date.press("4");
    await expect(date).toHaveValue("15/08/2014");
    await date.press("9");
    await expect(date).toHaveValue("15/08/2014");
    await date.fill("");
    await date.pressSequentially("31022015");
    await expect(date).toHaveAttribute("aria-invalid", "true");
    await date.fill("");
    await date.pressSequentially("29022024");
    await expect(date).toHaveValue("29/02/2024");
    await expect(date).toHaveAttribute("aria-invalid", "false");
    await date.fill("");
    await date.pressSequentially("29022023");
    await expect(date).toHaveAttribute("aria-invalid", "true");
    await date.fill("");
    await date.pressSequentially("15");
    await expect(date).toHaveValue("15/");
    await date.press("Backspace");
    await expect(date).toHaveValue("1");
    await date.pressSequentially("5082014");
    await expect(date).toHaveValue("15/08/2014");
    await date.press("Home");
    await date.press("Space");
    await date.press("ArrowRight");
    await date.press("ArrowRight");
    await date.press("Space");
    await expect(date).toHaveValue("15/08/2014");
    await date.press("ControlOrMeta+a");
    await date.evaluate((input) => {
      const data = new DataTransfer();
      data.setData("text", " 15a-08/2014 extra999 ");
      input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(date).toHaveValue("15/08/2014");
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await date.scrollIntoViewIfNeeded();
      const box = await date.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await expect(date).toHaveAttribute("inputmode", "numeric");
      await expect(date).toHaveAttribute("type", "text");
    }
  });
}
