import { createHash, randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { expect, type Browser, type Page } from "@playwright/test";

export const origin = "http://127.0.0.1:4173";
export function guard() {
  if (process.env.ACADEA_E2E_LOCAL_EMULATORS !== "YES" || process.env.VITE_FIREBASE_PROJECT_ID !== "demo-acadea"
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199"
    || process.env.ACADEA_E2E_BASE_URL !== origin
    || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Recette exclusivement locale demo-acadea, sans identifiants distants.");
  }
}
export type Handler = (req: unknown, res: unknown) => Promise<unknown>;
export async function invoke(handler: Handler, authorization: string, body: unknown, method = "POST") {
  let status = 200, payload: Record<string, unknown> = {};
  await handler({ method, headers: { authorization }, body }, {
    set statusCode(value: number) { status = value; },
    status(value: number) { status = value; return this; },
    setHeader() {},
    end(value: string) { payload = JSON.parse(value); },
    json(value: Record<string, unknown>) { payload = value; return this; },
  });
  return { status, payload };
}
export function fixture() {
  guard();
  const tag = "e2e-recipe-" + randomUUID().slice(0, 8);
  const app = initializeApp({ projectId: "demo-acadea", storageBucket: "demo-acadea.firebasestorage.app" });
  const db = getFirestore(app), auth = getAuth(app);
  const school = tag + "-school", other = tag + "-other", year = tag + "-year";
  const accounts: Record<string, { uid: string; email: string; password: string }> = {};
  const paths: string[] = [];
  async function put(path: string, value: Record<string, unknown>) {
    guard();
    expect((await db.doc(path).get()).exists).toBe(false);
    paths.push(path);
    await db.doc(path).create({ ...value, fixtureId: tag });
  }
  async function seed(roles: string[]) {
    for (const id of [school, other]) {
      await put("schools/" + id, { id, name: id === school ? "École recette locale" : "École témoin locale",
        status: "active", currency: "CDF", activeSchoolYearId: id === school ? year : tag + "-other-year",
        schoolOptions: ["Sciences", "Littéraire"], schoolType: "Secondaire uniquement", educationLevels: ["Secondaire"],
        subscriptionStatus: "active", subscriptionPlan: "premium", createdAt: new Date().toISOString() });
      const y = id === school ? year : tag + "-other-year";
      await put("schoolYears/" + y, { id: y, schoolId: id, name: "2026-2027", status: "active", currency: "CDF" });
    }
    for (const role of roles) {
      const uid = tag + "-" + role;
      accounts[role] = { uid, email: uid + "@example.invalid", password: "LocalOnly-" + randomUUID() + "!" };
      await auth.createUser(accounts[role]);
      await auth.setCustomUserClaims(uid, { role, ...(role === "super_admin" ? {} : { schoolId: school }) });
      await put("users/" + uid, { id: uid, role, schoolId: role === "super_admin" ? "" : school, name: "Compte fictif " + role,
        email: accounts[role].email, status: "active", active: true, activeSchoolYearId: year });
    }
  }
  async function token(role: string) {
    guard();
    const { email, password } = accounts[role];
    const response = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    if (!response.ok) throw new Error("Connexion émulateur refusée : " + response.status);
    return "Bearer " + (await response.json()).idToken;
  }
  async function session(browser: Browser, role: string, handlers: Record<string, Handler>, transport = { dropNextWriteResponse: false }) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort("blockedbyclient");
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const handler = handlers[url.pathname];
      if (!handler) return route.fulfill({ status: 404, body: "{}" });
      const result = await invoke(handler, request.headers().authorization || "", request.postData() ? request.postDataJSON() : {}, request.method());
      if (transport.dropNextWriteResponse && result.status === 200 && request.postDataJSON()?.action === "create-cash-inflow") {
        transport.dropNextWriteResponse = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.payload) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto("/login");
    await page.getByPlaceholder("email@ecole.com").fill(accounts[role].email);
    await page.getByPlaceholder("Votre mot de passe").fill(accounts[role].password);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 40_000 });
    return { page, context };
  }
  async function cleanup() {
    guard();
    for (const collection of await db.listCollections()) {
      for (const row of (await collection.get()).docs) {
        const data = row.data();
        const limiterOwned = collection.id === "_rateLimits" && typeof data.action === "string"
          && Object.values(accounts).some(account => data.actorIdHash === createHash("sha256").update([account.uid, "actor", data.action].join("\u001f")).digest("hex"));
        if (data.fixtureId === tag || [school, other].includes(data.schoolId) || limiterOwned) await row.ref.delete();
      }
    }
    for (const path of paths) expect((await db.doc(path).get()).exists).toBe(false);
    for (const account of Object.values(accounts)) {
      const record = await auth.getUser(account.uid);
      expect(record.email).toBe(account.email);
      await auth.deleteUser(account.uid);
      await expect(auth.getUser(account.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    }
    expect((await getStorage(app).bucket().getFiles({ prefix: tag }))[0]).toHaveLength(0);
    for (const collection of await db.listCollections()) {
      expect((await collection.where("fixtureId", "==", tag).get()).empty).toBe(true);
      expect((await collection.where("schoolId", "==", school).get()).empty).toBe(true);
      expect((await collection.where("schoolId", "==", other).get()).empty).toBe(true);
    }
    await deleteApp(app);
  }
  return { tag, app, db, auth, school, other, year, put, seed, token, session, cleanup };
}
export async function students(page: Page) {
  await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Ajouter un élève" })).toBeVisible();
}

