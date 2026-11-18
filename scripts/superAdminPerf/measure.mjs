// MESURE DU SUPER ADMINISTRATEUR SUR LE STAGING (aucune écriture dans l'application).
//   TOKEN=$(gcloud auth print-access-token) node scripts/superAdminPerf/measure.mjs [--libelle=500-ecoles]
// 1. Une fenêtre Chromium s'ouvre sur le staging : la personne se connecte elle-même.
//    Le mot de passe est tapé dans la fenêtre ; ce script ne le lit pas et ne l'affiche pas.
// 2. Le script ouvre chaque onglet et chaque drawer, chronomètre l'affichage, compte les
//    échanges et les octets reçus de Firestore, et la mémoire de la page.
// 3. Après 4 minutes (délai de Google), il lit dans Cloud Monitoring les lectures Firestore
//    du staging pendant la mesure (toutes sources : d'autres activités du staging comptent aussi).
// Le résultat est enregistré dans diagnostics/super-admin-perf/<date>-<libellé>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const STAGING = "https://acadea-staging.vercel.app";
const PROJECT = "acadea-staging";
const label = (process.argv.find((item) => item.startsWith("--libelle=")) ?? "--libelle=mesure").slice(10).replace(/[^\w-]/g, "");
if (!process.env.TOKEN) throw new Error("Lancez d'abord : TOKEN=$(gcloud auth print-access-token)");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Performance.enable");
const firestoreIds = new Set();
const traffic = { firestoreRequests: 0, firestoreBytes: 0, apiRequests: 0 };
const errors = [];
cdp.on("Network.requestWillBeSent", ({ requestId, request }) => {
  if (request.url.includes("firestore.googleapis.com")) { firestoreIds.add(requestId); traffic.firestoreRequests += 1; }
  if (request.url.startsWith(`${STAGING}/api/`)) traffic.apiRequests += 1;
});
cdp.on("Network.dataReceived", ({ requestId, encodedDataLength, dataLength }) => {
  if (firestoreIds.has(requestId)) traffic.firestoreBytes += encodedDataLength || dataLength || 0;
});
page.on("response", (response) => {
  if (response.url().startsWith(`${STAGING}/api/`) && response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
});
page.on("pageerror", (error) => errors.push(`erreur de page : ${String(error.message).slice(0, 160)}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console : ${message.text().slice(0, 160)}`); });

async function heapMb() {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Math.round((metrics.find((item) => item.name === "JSHeapUsedSize")?.value ?? 0) / 1024 / 1024);
}
const bodyHas = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), text, { timeout: 120_000 });
const dashboardReady = () => page.waitForFunction(() => {
  const card = [...document.querySelectorAll("article, div")].find((item) => item.textContent?.startsWith("Élèves totalisés"));
  return Boolean(card) && !card.textContent.includes("—");
}, undefined, { timeout: 180_000 });

await page.goto(`${STAGING}/login`);
console.log("\n>>> Connectez-vous maintenant dans la fenêtre Chromium avec le compte Super administrateur du staging (10 minutes maximum).\n");
const nav = page.getByRole("navigation", { name: "Navigation Super Administrateur" });
await nav.waitFor({ timeout: 600_000 });
console.log("Connexion vue. Mesure en cours, ne touchez plus la fenêtre…");
await page.waitForTimeout(5_000);

const start = new Date();
const rows = [];
async function step(name, action, ready) {
  const before = { ...traffic };
  const startedAt = Date.now();
  try { await action(); await ready(); }
  catch (error) { errors.push(`étape « ${name} » : ${String(error.message).split("\n")[0].slice(0, 160)}`); }
  rows.push({
    étape: name,
    "temps (ms)": Date.now() - startedAt,
    "échanges Firestore": traffic.firestoreRequests - before.firestoreRequests,
    "Ko Firestore": Math.round((traffic.firestoreBytes - before.firestoreBytes) / 1024),
    "appels API": traffic.apiRequests - before.apiRequests,
    "mémoire (Mo)": await heapMb(),
  });
}
const tab = (name) => nav.getByRole("button", { name, exact: true });
const search = page.getByPlaceholder("Rechercher une école...");

await step("Rechargement complet + Dashboard", () => page.reload(), dashboardReady);
await step("Onglet Écoles", () => tab("Écoles").click(), () => search.waitFor());
const schoolCards = await page.locator("article").count();
await step("Recherche « lumbula »", () => search.fill("lumbula"), () => page.waitForTimeout(800));
await step("Recherche vide", () => search.fill(""), () => page.waitForTimeout(800));
await step("Drawer d'une école", () => page.locator("article button").first().click(), () => page.getByRole("button", { name: "Fermer les informations de l'école" }).waitFor({ timeout: 120_000 }));
await page.getByRole("button", { name: "Fermer les informations de l'école" }).click().catch(() => {});
await step("Onglet Coordinations", () => tab("Coordinations").click(), () => page.waitForTimeout(3_000));
await step("Onglet Messages", () => tab("Messages").click(), () => bodyHas("Nouveau message"));
await step("Onglet Menu", () => tab("Menu").click(), () => bodyHas("Créer une école"));
await step("Drawer Créer une école", () => page.getByRole("button", { name: /Créer une école/ }).first().click(), () => page.getByRole("button", { name: "Fermer la création d'école" }).waitFor());
await page.getByRole("button", { name: "Fermer la création d'école" }).click().catch(() => {});
await step("Drawer Créer Coordination", () => page.getByRole("button", { name: /Créer Coordination/ }).first().click(), () => page.waitForTimeout(2_000));
await page.keyboard.press("Escape").catch(() => {});
await step("Retour Dashboard", () => tab("Dashboard").click(), dashboardReady);
await step("60 s sans rien faire (recherche de boucles)", () => page.waitForTimeout(60_000), async () => {});
await step("Bouton Actualiser", () => page.getByRole("button", { name: "Actualiser" }).click(), dashboardReady);
const end = new Date();
console.table(rows);
console.log(`Cartes d'école affichées dans l'onglet Écoles : ${schoolCards}`);
if (errors.length) console.log("Erreurs vues :", errors);
await browser.close();

console.log("Attente de 4 minutes pour les chiffres de Google…");
await new Promise((resolve) => setTimeout(resolve, 240_000));
const filter = encodeURIComponent('metric.type="firestore.googleapis.com/document/read_count"');
const url = `https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=${filter}&interval.startTime=${start.toISOString()}&interval.endTime=${new Date(end.getTime() + 60_000).toISOString()}`;
let reads = null;
try {
  const series = await fetch(url, { headers: { Authorization: `Bearer ${process.env.TOKEN}` } }).then((response) => response.json());
  reads = (series.timeSeries ?? []).flatMap((item) => item.points ?? []).reduce((sum, point) => sum + Number(point.value?.int64Value ?? 0), 0);
  console.log(`Lectures Firestore du staging pendant la mesure (toutes sources) : ${reads}`);
} catch {
  console.log("Lectures Firestore : chiffres de Google indisponibles.");
}
mkdirSync("diagnostics/super-admin-perf", { recursive: true });
const file = `diagnostics/super-admin-perf/${start.toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${label}.json`;
writeFileSync(file, JSON.stringify({ label, start, end, rows, schoolCards, reads, errors }, null, 2));
console.log(`Résultat enregistré : ${file}`);
