// ESSAI DU LOT SA-6 (« Messages » du Super administrateur) SUR LE STAGING. Jamais en production.
//
//   ACADEA_SOCIAL_STAGING=YES GOOGLE_CLOUD_PROJECT=acadea-staging GOOGLE_CLOUD_QUOTA_PROJECT=acadea-staging \
//   ACADEA_STAGING_GCLOUD_AUTH=YES ACADEA_STAGING_ACCESS_TOKEN=$(gcloud auth print-access-token) \
//   node scripts/superAdminMessagesStagingRecipe.mjs --mode=avant|apres [--step=retire]
//
// 1. Crée SES propres données d'essai (marque e2e-messages-<32 hexadécimaux>) : 3 écoles fictives et leur
//    administrateur, une coordination et son coordinateur, un compte Super administrateur d'essai, et un
//    message d'essai adressé à ce Super administrateur (avec sa notification non lue).
// 2. Se connecte avec le compte d'essai (mot de passe généré, gardé en mémoire seulement) et mesure, chaque
//    étape dans sa propre minute : ouverture de « Nouveau message », 1re ouverture de la cloche, 2e ouverture,
//    retour sur l'onglet Messages. Temps, échanges Firestore, appels au serveur, octets, lectures Firestore
//    du staging minute par minute (Cloud Monitoring : toutes activités du staging comprises).
// 3. Mode « apres » : essai complet (recherche d'une école puis d'une autre, choix gardés, envoi réel aux
//    administrateurs d'essai, recherche d'une coordination, cloche gardée), ordinateur et téléphone, captures.
// 4. Efface TOUT ce qu'elle a créé (écoles, comptes, messages, traces du compte d'essai) et vérifie qu'il ne reste rien.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, expect as baseExpect } from "@playwright/test";
import { services } from "./socialFinanceStagingFixture.mjs";
import { fixtureLeftovers, purgeStagingFixture } from "./stagingFixturePurge.mjs";
import { redactRecipeError } from "./hostedRecipeSafety.mjs";

const expect = baseExpect.configure({ timeout: 60000 });
const projectId = "acadea-staging";
const origin = process.env.ACADEA_MESSAGES_ORIGIN || "https://acadea-staging.vercel.app";
const arg = (name, fallback) => (process.argv.find((item) => item.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=")[1];
const mode = arg("mode", "apres");
const step = arg("step", "all");
assert.ok(["avant", "apres"].includes(mode), "Mode inconnu : avant ou apres.");
const output = `diagnostics/super-admin-messages/${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}`;
const manifestPath = "diagnostics/super-admin-messages/manifest.json";
const TAG = /^e2e-messages-[a-f0-9]{32}$/;
const results = [];
const measures = [];
const record = (name, result, detail) => { results.push({ name, result, ...(detail ? { detail } : {}) }); console.log(`${result === "PASS" ? "OK   " : "ÉCHEC"} : ${name}${detail ? ` — ${detail}` : ""}`); };
let password = "";
const checked = async (name, run) => {
  try { record(name, "PASS", (await run()) || undefined); }
  catch (error) { record(name, "FAIL", redactRecipeError(error, [password]).split("\n")[0].slice(0, 300)); process.exitCode = 1; }
};

function guard() {
  if (process.env.GOOGLE_CLOUD_PROJECT !== projectId || !origin.includes("acadea-staging")) throw Error("Essai réservé au staging (acadea-staging).");
}

async function prepare(s) {
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, "utf8")).retired) throw Error("Essai précédent non nettoyé : lancez --step=retire.");
  const tag = `e2e-messages-${randomUUID().replaceAll("-", "")}`;
  const short = tag.slice(-8);
  const documents = [];
  const add = (collection, id, data) => documents.push({ path: `${collection}/${id}`, data: { id, fixtureId: tag, ...data } });
  const now = new Date().toISOString();
  // Un mot distinct par école : une lettre seule (« a ») se retrouverait dans « messages » et répondrait pour les 3 écoles.
  const WORDS = { a: "Alpha", b: "Bravo", c: "Charlie" };
  const schools = ["a", "b", "c"].map((letter) => ({ id: `${tag}-school-${letter}`, yearId: `${tag}-year-${letter}`, adminId: `${tag}-admin-${letter}`, name: `[FICTIVE] Messages ${short} ${WORDS[letter]}` }));
  for (const school of schools) {
    add("schools", school.id, { name: school.name, status: "active", active: true, currency: "USD", address: "Adresse fictive", phone: "", email: "", schoolType: "Primaire uniquement",
      educationLevels: ["Primaire"], schoolOptions: [], activeSchoolYearId: school.yearId, subscriptionStatus: "active", subscriptionPlan: "Premium", createdAt: now });
    add("schoolYears", school.yearId, { schoolId: school.id, name: "2098-2099", status: "active", currency: "USD", startsAt: "2098-09-01", endsAt: "2099-07-31" });
    add("users", school.adminId, { role: "school_admin", schoolId: school.id, name: `Admin fictif ${short} ${school.id.slice(-1).toUpperCase()}`, email: `${school.adminId}@example.invalid`, active: true, status: "active", activeSchoolYearId: school.yearId });
  }
  const coordinationId = `${tag}-coordination`;
  add("coordinations", coordinationId, { name: `Coordination fictive ${short}`, code: "FICTIF", status: "active", referenceSchoolYear: "2098-2099", principalCoordinatorUserId: `${tag}-coordinator` });
  add("users", `${tag}-coordinator`, { role: "coordination_admin", coordinationId, schoolId: "", name: `Coordinateur fictif ${short}`, email: `${tag}-coordinator@example.invalid`, active: true, status: "active" });
  const platform = { uid: `${tag}-platform`, email: `${tag}-platform@example.invalid` };
  add("users", platform.uid, { role: "super_admin", schoolId: "", name: `Super administrateur fictif ${short}`, email: platform.email, active: true, status: "active" });
  // Un message d'un administrateur d'essai au Super administrateur d'essai, et sa notification non lue (pour la cloche).
  add("messages", `${tag}-message`, { platformMessage: true, senderId: schools[0].adminId, senderName: `Admin fictif ${short} A`, senderRole: "school_admin", recipientIds: [platform.uid],
    participantIds: [schools[0].adminId, platform.uid], recipientParentId: "school", subject: `Réponse d'essai ${short}`, body: "Message fictif de la recette.", createdAt: now,
    schoolId: schools[0].id, schoolYearId: schools[0].yearId, senderSchoolId: schools[0].id });
  add("notifications", `${tag}-notification`, { platformMessage: true, recipientUserId: platform.uid, audienceRoles: ["super_admin"], messageId: `${tag}-message`, type: "message",
    title: "Réponse d'essai", body: `Réponse d'essai ${short}`, createdAt: now, read: false, schoolId: schools[0].id, schoolYearId: schools[0].yearId });
  for (const row of documents) if ((await s.db.doc(row.path).get()).exists) throw Error(`Collision de document ${row.path}`);
  try { await s.auth.getUser(platform.uid); throw Error("Collision de compte."); } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
  const m = { projectId, tag, short, schools, coordinationId, platform, documents: documents.map((row) => row.path), createdAt: now, retired: false };
  mkdirSync("diagnostics/super-admin-messages", { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 }); // plan écrit AVANT toute écriture
  password = `Ephemeral-${randomUUID()}${randomUUID()}`;
  for (const row of documents) await s.db.doc(row.path).create(row.data);
  await s.auth.createUser({ uid: platform.uid, email: platform.email, password });
  await s.auth.setCustomUserClaims(platform.uid, { role: "super_admin" });
  return m;
}

const limiterId = (...parts) => createHash("sha256").update(parts.join("\u001f")).digest("hex");

/** Traces laissées par le compte d'essai lui-même (journal, demandes d'envoi, compteurs de limite). */
async function deleteAccountTraces(s, m) {
  const uid = m.platform.uid;
  let deleted = 0;
  const remove = async (docs) => { for (const item of docs) { await item.ref.delete(); deleted += 1; } };
  for (const collection of await s.db.listCollections()) {
    for (const field of ["actorId", "userId", "recipientUserId", "uid"]) {
      const rows = await collection.where(field, "==", uid).limit(500).get().catch(() => ({ docs: [] }));
      await remove(rows.docs);
    }
    const own = await collection.doc(uid).get().catch(() => null);
    if (own?.exists) await remove([own]);
    const prefixed = await collection.where("__name__", ">=", collection.doc(m.tag)).where("__name__", "<", collection.doc(`${m.tag}`)).limit(500).get().catch(() => ({ docs: [] }));
    await remove(prefixed.docs);
  }
  // Compteurs de limite : identifiant haché ; on ne garde que ceux dont la marque correspond au compte d'essai.
  const limits = await s.db.collection("_rateLimits").select("action", "actorIdHash").get();
  await remove(limits.docs.filter((item) => item.data().actorIdHash === limiterId(uid, "actor", item.data().action)));
  return deleted;
}

async function remainingIndexEntries(s, m) {
  const ids = new Set(m.schools.map((school) => school.id));
  const parts = await s.db.collection("schoolSearchIndex").get();
  return parts.docs.flatMap((part) => Object.keys(part.data()?.entries ?? {})).filter((id) => ids.has(id));
}

async function retire(s) {
  if (!existsSync(manifestPath)) return;
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (m.projectId !== projectId || !TAG.test(m.tag)) throw Error("Manifeste ambigu : nettoyage refusé.");
  if (m.retired) return;
  const report = await purgeStagingFixture({ db: s.db, auth: s.auth, bucket: s.bucket, projectId, tag: m.tag, extraUids: [m.platform.uid], knownSchoolIds: m.schools.map((school) => school.id) });
  const traces = await deleteAccountTraces(s, m);
  const leftovers = await fixtureLeftovers(s.db, m.tag, m.schools.map((school) => school.id));
  if (leftovers.length) throw Error(`Effacement incomplet : ${leftovers.join(", ")}`);
  let index = [];
  for (let attempt = 0; attempt < 12; attempt += 1) { index = await remainingIndexEntries(s, m); if (!index.length) break; await new Promise((resolve) => setTimeout(resolve, 5000)); }
  if (index.length) throw Error(`Lignes de recherche restantes : ${index.join(", ")}`);
  try { await s.auth.getUser(m.platform.uid); throw Error("Compte d'essai encore présent."); } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
  writeFileSync(manifestPath, JSON.stringify({ ...m, retired: true, retiredAt: new Date().toISOString(), report: { ...report, traces } }, null, 2), { mode: 0o600 });
  console.log(`Nettoyage : ${report.schools} école(s), ${report.accounts} compte(s), ${report.documents} document(s), ${traces} trace(s) du compte d'essai effacés ; aucun reste.`);
}

/** Lecture seule : combien de comptes l'ancienne liste complète lit à chaque ouverture. */
async function recipientUniverse(s) {
  const count = async (role) => (await s.db.collection("users").where("role", "==", role).count().get()).data().count;
  const counts = {};
  for (const role of ["coordination_admin", "sub_coordination_admin", "school_admin", "admin"]) counts[role] = await count(role);
  return counts;
}

async function waitIndexed(s, m) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const parts = await s.db.collection("schoolSearchIndex").get();
    const present = new Set(parts.docs.flatMap((part) => Object.keys(part.data()?.entries ?? {})));
    if (m.schools.every((school) => present.has(school.id))) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw Error("Les écoles d'essai n'apparaissent pas dans la liste de recherche du staging.");
}

async function open(browser, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const traffic = { firestore: 0, firestoreBytes: 0, api: 0, apiBytes: 0, recipientsApi: 0 };
  const firestoreIds = new Set(); const apiIds = new Set();
  cdp.on("Network.requestWillBeSent", ({ requestId, request }) => {
    if (request.url.includes("firestore.googleapis.com")) { firestoreIds.add(requestId); traffic.firestore += 1; }
    if (request.url.startsWith(`${origin}/api/`)) { apiIds.add(requestId); traffic.api += 1; if (request.url.includes("/api/message-recipients")) traffic.recipientsApi += 1; }
  });
  cdp.on("Network.dataReceived", ({ requestId, encodedDataLength, dataLength }) => {
    const size = encodedDataLength || dataLength || 0;
    if (firestoreIds.has(requestId)) traffic.firestoreBytes += size;
    if (apiIds.has(requestId)) traffic.apiBytes += size;
  });
  // Réseau parfois lent vers le staging : on attend le document seulement, avec plus de marge.
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByPlaceholder("email@ecole.com").fill(state.m.platform.email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Navigation Super Administrateur" })).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(8000);
  return { context, page, traffic };
}

/** Une étape mesurée, commencée au début d'une minute pour pouvoir lui attribuer les lectures du staging. */
async function measured(session, name, action, ready, { ownMinute = true } = {}) {
  if (ownMinute) { const wait = 60000 - (Date.now() % 60000) + 500; await session.page.waitForTimeout(wait); }
  const before = { ...session.traffic };
  const startedAt = Date.now();
  await action();
  await ready();
  const row = {
    étape: name, minute: new Date(startedAt).toISOString().slice(11, 16), "temps (ms)": Date.now() - startedAt,
    "échanges Firestore": session.traffic.firestore - before.firestore, "Ko Firestore": Math.round((session.traffic.firestoreBytes - before.firestoreBytes) / 1024),
    "appels serveur destinataires": session.traffic.recipientsApi - before.recipientsApi, "Ko serveur": Math.round((session.traffic.apiBytes - before.apiBytes) / 1024),
  };
  await session.page.waitForTimeout(3000);
  row["échanges Firestore (+3 s)"] = session.traffic.firestore - before.firestore;
  measures.push(row);
  console.log(JSON.stringify(row));
}

async function readsByMinute(startIso, endIso, token) {
  const filter = encodeURIComponent('metric.type="firestore.googleapis.com/document/read_count"');
  const params = `filter=${filter}&interval.startTime=${startIso}&interval.endTime=${endIso}&aggregation.alignmentPeriod=60s&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM`;
  const response = await fetch(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params}`, { headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": projectId } });
  const body = await response.json();
  if (!response.ok) throw Error(`Cloud Monitoring : ${response.status}`);
  // Le point se termine à la fin de la minute : on le rattache à la minute qui commence 60 s plus tôt.
  return Object.fromEntries((body.timeSeries ?? []).flatMap((series) => series.points ?? [])
    .map((point) => [new Date(Date.parse(point.interval.endTime) - 60000).toISOString().slice(11, 16), Number(point.value.int64Value ?? 0)]));
}

const state = { m: null };
const tab = (page, name) => page.getByRole("navigation", { name: "Navigation Super Administrateur" }).getByRole("button", { name, exact: true });
const bell = (page) => page.getByRole("button", { name: "Boîte à Messagerie" });
const recipientsReady = (page) => expect(page.locator("fieldset input[type=checkbox]").first()).toBeVisible({ timeout: 120000 });
const inboxReady = (page) => expect(page.getByText(`Réponse d'essai ${state.m.short}`).first()).toBeVisible({ timeout: 120000 });
const closeDrawer = async (page) => { await page.getByRole("button", { name: "Fermer la boîte à messagerie" }).first().click({ timeout: 10000 }); await expect(page.getByText("Messages et réponses")).toHaveCount(0, { timeout: 10000 }); };

async function run() {
  guard();
  const s = services();
  let browser;
  try {
    if (step === "retire") { await retire(s); return; }
    state.m = await prepare(s);
    const m = state.m;
    record(`Données d'essai créées (marque ${m.tag.slice(0, 13)}…)`, "PASS");
    await waitIndexed(s, m);
    record("Écoles d'essai présentes dans la liste de recherche du staging", "PASS");
    const universe = await recipientUniverse(s);
    record("Comptes que l'ancienne liste complète lit à chaque chargement", "PASS", JSON.stringify(universe));
    mkdirSync(output, { recursive: true });
    browser = await chromium.launch({ headless: true });

    // Mesures (ordinateur).
    const desk = await open(browser, { width: 1366, height: 900 });
    const firstMinute = new Date();
    await measured(desk, "Ouverture de « Nouveau message »", () => tab(desk.page, "Messages").click(), () => recipientsReady(desk.page));
    await desk.page.screenshot({ path: `${output}/ordinateur-nouveau-message.png`, fullPage: true });
    await measured(desk, "Cloche : 1re ouverture", () => bell(desk.page).click(), () => inboxReady(desk.page));
    await desk.page.screenshot({ path: `${output}/ordinateur-cloche.png` });
    await closeDrawer(desk.page);
    await measured(desk, "Cloche : 2e ouverture", () => bell(desk.page).click(), () => inboxReady(desk.page));
    await closeDrawer(desk.page);
    await measured(desk, "Retour sur l'onglet Messages", async () => { await tab(desk.page, "Dashboard").click(); await desk.page.waitForTimeout(1500); await tab(desk.page, "Messages").click(); }, () => recipientsReady(desk.page));

    if (mode === "apres") {
      const page = desk.page;
      await checked("Administrateurs d'école : recherche d'une école par son nom, choix gardés d'une recherche à l'autre", async () => {
        await page.getByLabel("Catégorie de destinataires").selectOption("school_admin");
        const search = page.getByLabel("Rechercher un destinataire");
        await search.fill(`messages ${m.short} alpha`);
        await expect(page.getByText("1 école(s) trouvée(s)")).toBeVisible();
        await page.getByLabel(new RegExp(`Admin fictif ${m.short} A`)).check();
        await search.fill(`messages ${m.short} bravo`);
        await page.getByLabel(new RegExp(`Admin fictif ${m.short} B`)).check();
        await expect(page.getByLabel("Destinataires choisis")).toContainText(`Admin fictif ${m.short} A`);
        await expect(page.getByLabel("Destinataires choisis")).toContainText(`Admin fictif ${m.short} B`);
        await page.screenshot({ path: `${output}/ordinateur-recherche-ecole.png`, fullPage: true });
      });
      await checked("Envoi aux deux administrateurs d'essai (messages et notifications créés)", async () => {
        await page.getByPlaceholder("Objet").fill(`Essai lot 6 ${m.short}`);
        await page.getByPlaceholder("Message").fill("Message fictif envoyé par la recette du lot 6.");
        await page.getByRole("button", { name: "Envoyer", exact: true }).click();
        await expect(page.getByRole("status")).toHaveText("Message envoyé.");
        const sent = await s.db.collection("messages").where("schoolId", "in", [m.schools[0].id, m.schools[1].id]).get();
        const mine = sent.docs.map((item) => item.data()).filter((item) => item.subject === `Essai lot 6 ${m.short}`);
        assert.equal(mine.length, 2);
        return `${mine.length} messages`;
      });
      await checked("Coordinations : recherche par le nom de la coordination", async () => {
        await page.getByLabel("Catégorie de destinataires").selectOption("coordination_admin");
        await page.getByLabel("Rechercher un destinataire").fill(`coordination fictive ${m.short}`);
        await expect(page.getByLabel(new RegExp(`Coordinateur fictif ${m.short}`))).toBeVisible();
        await expect(page.getByText(`Coordination fictive ${m.short}`).first()).toBeVisible();
      });
      await checked("Recherche sans résultat : message clair", async () => {
        await page.getByLabel("Rechercher un destinataire").fill(`introuvable ${m.short}`);
        await expect(page.getByText("Aucun destinataire trouvé.")).toBeVisible();
      });
      await checked("Cloche gardée : aucune nouvelle écoute Firestore à la 2e ouverture", async () => {
        const second = measures.find((row) => row.étape === "Cloche : 2e ouverture");
        assert.ok(second["échanges Firestore (+3 s)"] === 0, `${second["échanges Firestore (+3 s)"]} échange(s)`);
      });
    }
    await desk.context.close();

    // Téléphone.
    const phone = await open(browser, { width: 390, height: 844 });
    await checked("Téléphone : « Nouveau message » et cloche lisibles, sans débordement", async () => {
      await tab(phone.page, "Messages").click();
      await recipientsReady(phone.page);
      if (mode === "apres") {
        await phone.page.getByLabel("Catégorie de destinataires").selectOption("school_admin");
        await phone.page.getByLabel("Rechercher un destinataire").fill(`messages ${m.short}`);
        await expect(phone.page.getByText("3 école(s) trouvée(s)")).toBeVisible();
      }
      const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await phone.page.screenshot({ path: `${output}/telephone-nouveau-message.png`, fullPage: true });
      await bell(phone.page).click();
      await inboxReady(phone.page);
      await phone.page.screenshot({ path: `${output}/telephone-cloche.png` });
      assert.ok(overflow <= 1, `débordement horizontal de ${overflow} px`);
    });
    await phone.context.close();

    record("Attente de 4 minutes pour les chiffres de Google", "PASS");
    await new Promise((resolve) => setTimeout(resolve, 240000));
    try {
      const token = (await import("node:child_process")).execSync(process.platform === "win32" ? "gcloud.cmd auth print-access-token" : "gcloud auth print-access-token", { encoding: "utf8" }).trim();
      const perMinute = await readsByMinute(new Date(firstMinute.getTime() - 120000).toISOString(), new Date().toISOString(), token);
      for (const row of measures) row["lectures Firestore du staging dans la minute (toutes sources)"] = perMinute[row.minute] ?? null;
    } catch (error) { record("Lectures Firestore minute par minute", "FAIL", redactRecipeError(error).slice(0, 200)); }
    console.table(measures);
  } finally {
    await browser?.close().catch(() => {});
    if (step !== "retire") {
      try { await retire(s); record("Staging remis en état : tout effacé, aucun reste", "PASS"); }
      catch (error) { record("Staging remis en état", "FAIL", redactRecipeError(error, [password]).slice(0, 300)); process.exitCode = 1; }
      mkdirSync(output, { recursive: true });
      writeFileSync(`${output}/resultat.json`, JSON.stringify({ mode, origin, results, measures }, null, 2));
      console.log(`Résultat : ${output}/resultat.json`);
    }
    password = "";
    await s.close();
  }
}

await run();
