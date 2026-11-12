import { chromium } from "@playwright/test";

// Diagnostic Production volontairement sans identifiants, stockage persistant,
// captures, traces ni contenu de réponse. L'utilisateur se connecte lui-même.
const origin = "https://acadea-app.vercel.app";
const expectedSha = "bb1989dffd3724d276bd6039ccd0866ad8a9501b";
const smokeOnly = process.argv.includes("--smoke");
if (!smokeOnly && !process.argv.includes("--interactive")) {
  throw new Error("Utiliser explicitement --interactive pour ouvrir une session de diagnostic Production.");
}
const allowedErrorCodes = new Set([
  "permission-denied", "unauthenticated", "resource-exhausted", "quota-exceeded",
  "failed-precondition", "unavailable", "deadline-exceeded", "internal",
  "not-found", "invalid-argument", "already-exists", "forbidden",
]);

function serviceLabel(rawUrl) {
  const url = new URL(rawUrl);
  if (url.origin === origin) {
    const endpoint = url.pathname.match(/^\/api\/([a-z-]+)/i)?.[1];
    return endpoint ? `Acadéa API/${endpoint}` : "Acadéa page";
  }
  if (url.hostname === "firestore.googleapis.com") return "Firestore";
  if (url.hostname === "identitytoolkit.googleapis.com" || url.hostname === "securetoken.googleapis.com") return "Firebase Auth";
  if (url.hostname.includes("firebasestorage.googleapis.com")) return "Firebase Storage";
  if (url.hostname.endsWith("cloudfunctions.net")) return "Firebase Functions";
  return "Autre service";
}

function isKnownMutation(request) {
  const url = new URL(request.url());
  const method = request.method().toUpperCase();
  if (url.hostname === "firestore.googleapis.com") {
    return /\/Firestore\/(Write|Commit|BatchWrite)\b|documents:(commit|batchWrite)\b/i.test(url.pathname);
  }
  if (url.hostname.includes("firebasestorage.googleapis.com")) return !["GET", "HEAD", "OPTIONS"].includes(method);
  if (url.hostname.endsWith("cloudfunctions.net")) return !["GET", "HEAD", "OPTIONS"].includes(method);
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  if (method !== "POST") return true;
  let action = "";
  try {
    const body = request.postDataJSON();
    action = typeof body?.action === "string" ? body.action : "";
  } catch { /* Ne jamais journaliser le corps de la requête. */ }
  return !(url.pathname === "/api/manage-financial-transaction" && /^(list|get|search|fetch)-[a-z-]+$/i.test(action));
}

function safeErrorCode(payload) {
  const value = typeof payload?.code === "string" ? payload.code
    : typeof payload?.error?.status === "string" ? payload.error.status : "";
  const normalized = value.toLowerCase().replace(/^(firestore|storage|functions)\//, "").replaceAll("_", "-");
  return allowedErrorCodes.has(normalized) ? normalized : undefined;
}

const browser = await chromium.launch({ channel: "chrome", headless: false });
const context = await browser.newContext({ acceptDownloads: false });
const page = await context.newPage();
let mutationBlocked = 0;
let abortedFirestoreListeners = 0;

async function visitReadOnlyTab(name) {
  const navigation = page.getByRole("navigation", { name: "Navigation principale" });
  const button = navigation.getByRole("button", { name, exact: true });
  if (!(await button.count())) {
    console.log(JSON.stringify({ event: "view-unavailable", view: name }));
    return false;
  }
  await button.click({ timeout: 10_000 });
  await page.waitForTimeout(4_000);
  console.log(JSON.stringify({ event: "read-only-view", view: name }));
  return true;
}

async function inspectSchoolAdminViews() {
  // Ne jamais interroger ou afficher les données d'un autre établissement.
  const header = page.locator("header");
  const schoolLabel = header.getByText(/C\.S\.?\s*LUMBULA/i).first();
  const adminRole = header.getByText("Administrateur d'école", { exact: true });
  try {
    await schoolLabel.waitFor({ state: "visible", timeout: 20_000 });
    await adminRole.waitFor({ state: "visible", timeout: 5_000 });
  }
  catch {
    console.log(JSON.stringify({ event: "school-or-role-scope-unverified", expected: "C.S LUMBULA / school_admin" }));
    return;
  }
  if (!(await page.getByRole("navigation", { name: "Navigation principale" }).count())) {
    console.log(JSON.stringify({ event: "admin-navigation-unavailable" }));
    return;
  }

  if (await visitReadOnlyTab("Dashboard")) {
    const currencyLoading = page.getByRole("status").filter({ hasText: "Vérification des devises historiques en cours" });
    await currencyLoading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
    const currencyError = page.getByRole("alert").filter({ hasText: "Vérification des devises indisponible" });
    const arrearsError = page.getByRole("alert").filter({ hasText: "les arriérés historiques ne sont pas vérifiés" });
    const arrearsValueError = page.getByRole("alert").filter({ hasText: "Arriérés indisponibles" });
    const arrearsLoading = page.getByRole("status").filter({ hasText: "Chargement des arriérés" });
    await arrearsLoading.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
    const arrearsVerified = page.getByTitle("Dettes des années antérieures, calculées par le service financier officiel");
    const currencyMismatch = page.getByRole("alert").filter({ hasText: "devise inconnue ou différente" });
    const pdfButton = page.getByRole("button", { name: "Exporter PDF", exact: true }).first();
    console.log(JSON.stringify({
      event: "dashboard-read-only-state",
      currencyLoading: await currencyLoading.isVisible(),
      currencyError: await currencyError.isVisible(),
      arrearsError: await arrearsError.isVisible(),
      arrearsValueError: await arrearsValueError.isVisible(),
      arrearsLoading: await arrearsLoading.isVisible(),
      arrearsVerified: await arrearsVerified.isVisible(),
      currencyMismatch: await currencyMismatch.isVisible(),
      pdfUnavailable: await pdfButton.count() ? await pdfButton.isDisabled() : null,
    }));
    const refreshButton = header.getByRole("button", { name: "Actualiser", exact: true });
    if (await refreshButton.count() && await refreshButton.isEnabled()) {
      await refreshButton.click({ timeout: 10_000 });
      const refreshStarted = await page.waitForFunction(() => Boolean(document.querySelector('header button[aria-label="Actualiser"]:disabled')), null, { timeout: 5_000 }).then(() => true).catch(() => false);
      if (refreshStarted) {
        await page.waitForFunction(() => Boolean(document.querySelector('header button[aria-label="Actualiser"]:not(:disabled)')), null, { timeout: 20_000 }).catch(() => undefined);
      }
      console.log(JSON.stringify({
        event: "dashboard-refresh-read-only-state",
        refreshStarted,
        refreshCompleted: await refreshButton.isEnabled(),
        refreshError: await header.locator("span.text-red-600").count() > 0,
        currencyError: await currencyError.isVisible(),
        arrearsError: await arrearsError.isVisible(),
        arrearsValueError: await arrearsValueError.isVisible(),
      }));
    }
  }
  if (await visitReadOnlyTab("Élèves")) {
    const studentLoading = page.getByText("Chargement des élèves…", { exact: true });
    await studentLoading.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => undefined);
    const studentError = page.getByRole("alert").filter({ hasText: "Impossible de charger les élèves" });
    const studentErrorVisible = await studentError.isVisible();
    const studentErrorText = studentErrorVisible ? await studentError.textContent({ timeout: 2_000 }) : "";
    console.log(JSON.stringify({ event: "students-read-only-state", loading: await studentLoading.isVisible(), error: studentErrorVisible, quotaText: /quota exceeded/i.test(studentErrorText ?? "") }));
    const search = page.getByPlaceholder("Rechercher", { exact: true }).first();
    if (await search.count()) {
      await search.fill("__ACADEA_P0_NO_MATCH__");
      await page.waitForTimeout(2_000);
      const searchError = await studentError.isVisible();
      await search.fill("");
      await page.waitForTimeout(2_000);
      console.log(JSON.stringify({ event: "student-search-read-only", error: searchError }));
    }
  }
  if (await visitReadOnlyTab("Contrôle")) {
    console.log(JSON.stringify({ event: "control-read-only-state", alertCount: await page.getByRole("alert").count() }));
  }
  if (await visitReadOnlyTab("Menu")) {
    const valves = page.getByRole("button", { name: /Valves/i }).first();
    if (await valves.count()) {
      await valves.click({ timeout: 10_000 });
      await page.waitForTimeout(4_000);
      console.log(JSON.stringify({ event: "read-only-view", view: "Valves" }));
    } else console.log(JSON.stringify({ event: "view-unavailable", view: "Valves" }));
  }
  // L'IA et les pièces jointes nécessitent une action distincte : aucun envoi
  // de prompt ou de fichier n'est déclenché par ce diagnostic en lecture seule.
  console.log(JSON.stringify({ event: "read-only-scan-complete", mutationBlocked, abortedFirestoreListeners }));
}

process.once("SIGINT", () => { void browser.close(); });
process.once("SIGTERM", () => { void browser.close(); });

await context.route("**/*", async (route) => {
  if (isKnownMutation(route.request())) {
    mutationBlocked += 1;
    console.log(JSON.stringify({ event: "mutation-blocked", service: serviceLabel(route.request().url()) }));
    await route.abort();
    return;
  }
  await route.continue();
});

page.on("pageerror", (error) => {
  console.log(JSON.stringify({ event: "javascript-error", kind: error.name || "Error" }));
});
page.on("requestfailed", (request) => {
  const service = serviceLabel(request.url());
  const reason = request.failure()?.errorText?.match(/net::[A-Z_]+/)?.[0] ?? "unknown";
  if (service === "Firestore" && reason === "net::ERR_ABORTED") { abortedFirestoreListeners += 1; return; }
  console.log(JSON.stringify({ event: "request-failed", service, reason }));
});
page.on("response", (response) => {
  if (response.status() < 400) return;
  void (async () => {
    let code;
    if (response.headers()["content-type"]?.includes("json")) {
      try { code = safeErrorCode(await response.json()); } catch { /* Aucun contenu n'est conservé. */ }
    }
    console.log(JSON.stringify({ event: "http-error", service: serviceLabel(response.url()), status: response.status(), ...(code ? { code } : {}) }));
  })();
});

try {
  const versionResponse = await context.request.get(`${origin}/version.json`, { timeout: 15_000 });
  const version = versionResponse.ok() ? await versionResponse.json() : null;
  if (version?.version !== expectedSha) throw new Error("SHA Production différent du SHA attendu ; diagnostic interrompu.");
  console.log(JSON.stringify({ event: "production-version", sha: version.version }));
  const response = await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 25_000 });
  console.log(JSON.stringify({ event: "login-page", status: response?.status(), service: "Acadéa Production" }));
  if (!response?.ok()) throw new Error("Page de connexion indisponible.");
  if (smokeOnly) {
    console.log(JSON.stringify({ event: "smoke-complete", mutationBlocked }));
  } else {
    console.log("Saisissez les identifiants de test uniquement dans la fenêtre Chrome Acadéa ouverte. Aucun identifiant n'est lu ou journalisé par ce script.");
    await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login", { timeout: 600_000 });
    console.log(JSON.stringify({ event: "post-login-navigation", mutationBlocked }));
    await inspectSchoolAdminViews();
    console.log("Diagnostic en lecture seule terminé. La fenêtre de test va se fermer.");
  }
} finally {
  await browser.close();
}
