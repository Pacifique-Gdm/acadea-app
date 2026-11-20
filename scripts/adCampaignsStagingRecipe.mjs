// ESSAI DES CAMPAGNES PUBLICITAIRES SUR LE STAGING (jamais en production).
//
//   ACADEA_SOCIAL_STAGING=YES ACADEA_AD_STAGING=YES GOOGLE_CLOUD_PROJECT=acadea-staging \
//   GOOGLE_CLOUD_QUOTA_PROJECT=acadea-staging ACADEA_STAGING_GCLOUD_AUTH=YES \
//   ACADEA_STAGING_ACCESS_TOKEN=$(gcloud auth print-access-token) \
//   node scripts/adCampaignsStagingRecipe.mjs [--step=all|retire]
//
// 1. Crée une école fictive, ses comptes fictifs et DEUX fausses campagnes qui ne visent
//    QUE cette école fictive (aucune vraie école du staging ne les voit).
// 2. Lance la version locale de l'application branchée sur le staging et vérifie :
//    bannière + ligne fine, rotation pondérée (2 pour 1) toutes les 10 s avec fondu,
//    image téléphone, aucune publicité sur le Contrôle, clic, envoi groupé des
//    statistiques, tiroir du Super administrateur.
// 3. Remet tout en état : campagnes, images et statistiques fictives supprimées,
//    document des campagnes actives restauré, comptes désactivés, école rendue inactive.
// Les mots de passe des comptes fictifs restent en mémoire : jamais écrits ni affichés.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { guard as baseGuard, services as baseServices } from "./socialFinanceStagingFixture.mjs";
import { deleteSchoolCompletely } from "../api/_lib/schoolDeletion.js";

const projectId = "acadea-staging";
const output = "diagnostics/ad-campaigns-staging";
const manifestPath = `${output}/manifest.json`;
const port = 5199;
const origin = process.env.ACADEA_AD_ORIGIN || `http://127.0.0.1:${port}`;
const localServer = !process.env.ACADEA_AD_ORIGIN;
const step = (process.argv.find((item) => item.startsWith("--step=")) ?? "--step=all").slice(7);
const results = [];
const record = (name, result, detail) => { results.push({ name, result, ...(detail ? { detail } : {}) }); console.log(`${result === "PASS" ? "OK " : "ÉCHEC"} : ${name}${detail ? ` — ${detail}` : ""}`); };
const checked = async (name, run) => {
  try { record(name, "PASS", await run() || undefined); }
  catch (error) { record(name, "FAIL", String(error.message).split("\n")[0].slice(0, 300)); process.exitCode = 1; }
};

function guard() {
  baseGuard();
  if (process.env.ACADEA_AD_STAGING !== "YES" || process.env.GOOGLE_CLOUD_PROJECT !== projectId) throw Error("Essai réservé à acadea-staging (ACADEA_AD_STAGING=YES).");
}

function kinshasaDay(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kinshasa", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offset * 86400000));
  return parts;
}

function banner(width, height, label, color) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.font = `bold ${Math.round(height / 4)}px sans-serif`;
  context.fillText(label, Math.round(width * 0.06), Math.round(height * 0.6));
  return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
}

async function prepare(s) {
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, "utf8")).retired) throw Error("Essai précédent non nettoyé : lancez --step=retire.");
  const tag = `e2epub${randomBytes(4).toString("hex")}`;
  const today = kinshasaDay();
  const year = Number(today.slice(0, 4));
  const academicStart = Number(today.slice(5, 7)) >= 9 ? year : year - 1;
  const schoolId = `${tag}-school`;
  const yearId = `${tag}-year`;
  const users = [
    { key: "admin", role: "school_admin", uid: `${tag}-admin`, email: `${tag}-admin@example.invalid`, schoolId },
    { key: "platform", role: "super_admin", uid: `${tag}-platform`, email: `${tag}-platform@example.invalid`, schoolId: "" },
  ];
  const documents = [
    { path: `schools/${schoolId}`, data: { id: schoolId, fixtureId: tag, name: "[FICTIVE] École publicité", status: "active", active: true, currency: "USD",
      address: "Adresse fictive", phone: "", email: "", schoolType: "Primaire uniquement", educationLevels: ["Primaire"], schoolOptions: [],
      activeSchoolYearId: yearId, subscriptionStatus: "active", subscriptionPlan: "Premium" } },
    { path: `schoolYears/${yearId}`, data: { id: yearId, fixtureId: tag, schoolId, name: `${academicStart}-${academicStart + 1}`, status: "active", currency: "USD",
      startsAt: `${academicStart}-09-01`, endsAt: `${academicStart + 1}-07-31` } },
    { path: `classes/${tag}-class`, data: { id: `${tag}-class`, fixtureId: tag, schoolId, schoolYearId: yearId, name: "1ère Primaire", section: "Primaire", active: true } },
    ...users.map((user) => ({ path: `users/${user.uid}`, data: { id: user.uid, fixtureId: tag, role: user.role, schoolId: user.schoolId,
      name: `Compte fictif publicité ${user.key}`, email: user.email, active: true, status: "active", activeSchoolYearId: user.schoolId ? yearId : "" } })),
  ];
  const now = new Date().toISOString();
  const campaigns = [
    { id: `${tag}-a`, brand: "[FICTIVE] Campagne A", color: "#0f766e", weight: 2 },
    { id: `${tag}-b`, brand: "[FICTIVE] Campagne B", color: "#1d4ed8", weight: 1 },
  ].map((item) => ({
    campaign: { id: item.id, brand: item.brand, linkUrl: "https://example.com/", startDate: kinshasaDay(-1), endDate: kinshasaDay(2),
      targetMode: "schools", schoolIds: [schoolId], coordinationId: "", roles: ["school_admin", "cashier", "parent"], weight: item.weight,
      status: "scheduled", desktopVersion: `${item.id}-d1`, phoneVersion: `${item.id}-p1`, createdAt: now, updatedAt: now, updatedBy: `${tag}-platform` },
    desktop: banner(1200, 150, item.brand, item.color),
    phone: banner(720, 240, item.brand, item.color),
  }));
  const activeRef = s.db.doc("platformSettings/adsActive");
  const previous = await activeRef.get();
  for (const row of documents) if ((await s.db.doc(row.path).get()).exists) throw Error(`Collision de document ${row.path}`);
  const m = { projectId, tag, schoolId, yearId, users, documents: documents.map((row) => row.path), campaigns: campaigns.map((item) => item.campaign.id),
    previousAdsActive: previous.exists ? previous.data() : null, createdAt: now, retired: false };
  mkdirSync(output, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 }); // plan écrit AVANT toute écriture
  const password = `Ephemeral-${randomUUID()}${randomUUID()}`;
  for (const row of documents) await s.db.doc(row.path).create(row.data);
  for (const user of users) {
    await s.auth.createUser({ uid: user.uid, email: user.email, password });
    await s.auth.setCustomUserClaims(user.uid, { role: user.role, ...(user.schoolId ? { schoolId: user.schoolId } : {}) });
  }
  for (const item of campaigns) {
    await s.db.doc(`adCampaigns/${item.campaign.id}`).create(item.campaign);
    await s.db.doc(`adCreatives/${item.campaign.id}_desktop`).create({ campaignId: item.campaign.id, format: "desktop", imageUrl: item.desktop, version: item.campaign.desktopVersion, updatedAt: now });
    await s.db.doc(`adCreatives/${item.campaign.id}_phone`).create({ campaignId: item.campaign.id, format: "phone", imageUrl: item.phone, version: item.campaign.phoneVersion, updatedAt: now });
  }
  const keep = (m.previousAdsActive?.campaigns ?? []).filter((entry) => !m.campaigns.includes(entry.id));
  const active = campaigns.map(({ campaign }) => ({ id: campaign.id, brand: campaign.brand, linkUrl: campaign.linkUrl, startDate: campaign.startDate, endDate: campaign.endDate,
    targetMode: campaign.targetMode, schoolIds: campaign.schoolIds, coordinationId: "", roles: campaign.roles, weight: campaign.weight,
    desktopVersion: campaign.desktopVersion, phoneVersion: campaign.phoneVersion }));
  await activeRef.set({ rotationSeconds: 10, campaigns: [...keep, ...active], updatedAt: now });
  return { m, password };
}

async function retire(s) {
  if (!existsSync(manifestPath)) return;
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (m.projectId !== projectId || !/^e2epub[a-f0-9]{8}$/.test(m.tag)) throw Error("Manifeste ambigu : nettoyage refusé.");
  if (m.retired) return;
  for (const campaignId of m.campaigns) {
    if (!campaignId.startsWith(`${m.tag}-`)) throw Error("Campagne étrangère : nettoyage refusé.");
    const stats = await s.db.collection("adStats").where("campaignId", "==", campaignId).get();
    for (const entry of stats.docs) await entry.ref.delete();
    await s.db.doc(`adCreatives/${campaignId}_desktop`).delete();
    await s.db.doc(`adCreatives/${campaignId}_phone`).delete();
    await s.db.doc(`adCampaigns/${campaignId}`).delete();
  }
  const activeRef = s.db.doc("platformSettings/adsActive");
  if (m.previousAdsActive) await activeRef.set(m.previousAdsActive);
  else await activeRef.delete();
  // 20/11 : l'école d'essai et tout ce qu'elle a créé sont EFFACÉS (avant : désactivés et gardés sur le staging).
  for (const path of m.documents) {
    const snapshot = await s.db.doc(path).get();
    if (snapshot.exists && snapshot.data().fixtureId !== m.tag) throw Error("Document étranger : nettoyage refusé.");
  }
  const school = await s.db.doc(`schools/${m.schoolId}`).get();
  if (school.exists) {
    await deleteSchoolCompletely({ db: s.db, auth: s.auth, bucket: s.bucket, schoolId: m.schoolId, schoolData: school.data(),
      actor: { uid: "recette-staging-nettoyage", role: "staging_fixture_cleanup" } });
  }
  for (const path of m.documents) {
    const snapshot = await s.db.doc(path).get();
    if (snapshot.exists) await snapshot.ref.delete();
  }
  for (const user of m.users) {
    if (!user.uid.startsWith(m.tag)) throw Error("Compte étranger : nettoyage refusé.");
    try {
      const account = await s.auth.getUser(user.uid);
      if (!String(account.email ?? "").endsWith("@example.invalid")) throw Error("Compte étranger : nettoyage refusé.");
      await s.auth.deleteUser(user.uid);
    } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
  }
  const restes = [];
  for (const path of [...m.documents, `schools/${m.schoolId}`]) if ((await s.db.doc(path).get()).exists) restes.push(path);
  if (restes.length) throw Error(`Nettoyage incomplet : ${restes.join(", ")}`);
  writeFileSync(manifestPath, JSON.stringify({ ...m, retired: true, retiredAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log("Nettoyage terminé : campagnes, images, statistiques, école, documents et comptes fictifs effacés.");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error("Serveur local introuvable.");
}

async function login(browser, account, password, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByPlaceholder("email@ecole.com").fill(account.email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Menu", exact: true }).last()).toBeVisible({ timeout: 90000 });
  return { context, page };
}

async function run() {
  guard();
  const s = baseServices();
  let server;
  let browser;
  try {
    if (step === "retire") { await retire(s); return; }
    const { m, password } = await prepare(s);
    record("École, comptes et deux fausses campagnes créés (visibles de l'école fictive seulement)", "PASS");
    if (localServer) server = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "--mode", "staging", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { shell: process.platform === "win32", stdio: "ignore", windowsHide: true });
    await waitForServer();
    if (process.env.ACADEA_EXPECTED_SHA) {
      const served = await (await fetch(`${origin}/version.json`)).json();
      assert.equal(served.version, process.env.ACADEA_EXPECTED_SHA, "Le staging ne sert pas la version attendue.");
      record(`Le staging sert bien la version ${served.version.slice(0, 7)}`, "PASS");
    }
    browser = await chromium.launch();
    const admin = m.users.find((user) => user.key === "admin");
    const platform = m.users.find((user) => user.key === "platform");
    const [campaignA, campaignB] = m.campaigns;

    const { context, page } = await login(browser, admin, password);
    const bannerLink = page.getByTestId("header-ad-banner");
    await checked("Bannière « Publicité » à la place du grand en-tête, ligne fine avec le nom de l'école", async () => {
      await expect(bannerLink).toBeVisible({ timeout: 60000 });
      await expect(bannerLink).toContainText("Publicité");
      await expect(page.getByTestId("header-ad-mode")).toContainText("[FICTIVE] École publicité");
      await expect(page.getByText(/^Bonjour, /)).toHaveCount(0);
    });
    await checked("Les deux campagnes tournent toutes les 10 s, la A deux fois plus souvent (fondu doux)", async () => {
      const seen = [];
      const time = { A: 0, B: 0 };
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const alt = await bannerLink.locator("img").getAttribute("alt").catch(() => "");
        const letter = alt.includes("Campagne A") ? "A" : alt.includes("Campagne B") ? "B" : "";
        if (letter) time[letter] += 1;
        if (letter && seen[seen.length - 1] !== letter) seen.push(letter);
        await page.waitForTimeout(500);
      }
      const ratio = time.B ? time.A / time.B : 0;
      assert.ok(seen.filter((letter) => letter === "B").length >= 2 && ratio >= 1.4 && ratio <= 2.8,
        `ordre vu : ${seen.join(" ")} ; temps A/B = ${ratio.toFixed(2)}`);
      const style = await bannerLink.getAttribute("style");
      assert.match(style ?? "", /opacity 450ms/);
      return `ordre vu : ${seen.join(" ")} ; temps d'affichage A/B = ${ratio.toFixed(2)} (attendu ≈ 2)`;
    });
    await checked("Aucune publicité sur le Contrôle (paiements, reçus)", async () => {
      await page.getByRole("button", { name: "Contrôle", exact: true }).last().click();
      await expect(bannerLink).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByText(/^Bonjour, /)).toBeVisible();
      await page.getByRole("button", { name: "Dashboard", exact: true }).last().click();
      await expect(bannerLink).toBeVisible({ timeout: 15000 });
    });
    await checked("Le clic ouvre le lien de la marque dans un nouvel onglet", async () => {
      const [popup] = await Promise.all([context.waitForEvent("page"), bannerLink.click()]);
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      assert.match(popup.url(), /^https:\/\/example\.com/);
      await popup.close();
    });
    await checked("Comptes gardés sur l'appareil, puis envoyés en un seul paquet le lendemain", async () => {
      const yesterday = kinshasaDay(-1);
      await page.evaluate((day) => {
        const raw = JSON.parse(localStorage.getItem("acadea.adStats.pending") || "{}");
        const moved = {};
        for (const report of Object.values(raw)) { const next = { ...report, day }; moved[[next.campaignId, next.day, next.device, next.role, next.schoolId].join("|")] = next; }
        localStorage.setItem("acadea.adStats.pending", JSON.stringify(moved));
      }, yesterday);
      await page.reload();
      await expect(bannerLink).toBeVisible({ timeout: 60000 });
      let docs = [];
      await expect.poll(async () => {
        docs = (await s.db.collection("adStats").where("campaignId", "in", [campaignA, campaignB]).get()).docs.map((entry) => entry.data());
        return docs.length;
      }, { timeout: 60000 }).toBeGreaterThanOrEqual(2);
      const total = (field) => docs.reduce((sum, data) => sum + (data[field] ?? 0), 0);
      assert.ok(total("v") >= 3, "affichages manquants");
      assert.ok(total("c") >= 1, "clic manquant");
      assert.equal(total(`s_${m.schoolId}_v`), total("v"));
      assert.equal(total("r_school_admin_v"), total("v"));
      assert.ok(docs.every((data) => Object.keys(data).every((key) => /^(campaignId|date|shard|[vc][dp]?|r_[a-z_]+_[vc]|s_.+_[vc])$/.test(key))), "champ inattendu");
      return `${docs.length} paquet(s), ${total("v")} affichage(s), ${total("c")} clic(s), aucun champ personnel`;
    });
    await context.close();

    const phone = await login(browser, admin, password, { width: 390, height: 844 });
    await checked("Téléphone : image légère 720 × 240 et ligne fine", async () => {
      const link = phone.page.getByTestId("header-ad-banner");
      await expect(link).toBeVisible({ timeout: 60000 });
      await expect.poll(() => link.locator("img").evaluate((image) => image.naturalWidth), { timeout: 30000 }).toBe(720);
    });
    await phone.context.close();

    const superAdmin = await login(browser, platform, password);
    await checked("Super administrateur : tiroir « Campagnes publicitaires », liste et statistiques", async () => {
      const page = superAdmin.page;
      await expect(page.getByTestId("header-ad-banner")).toHaveCount(0);
      await page.getByRole("button", { name: "Menu", exact: true }).last().click();
      await page.getByRole("button", { name: /Campagnes publicitaires/ }).click();
      const drawer = page.getByTestId("ad-campaigns-drawer");
      await expect(drawer).toContainText("[FICTIVE] Campagne A", { timeout: 30000 });
      await expect(drawer).toContainText("[FICTIVE] Campagne B");
      await expect(drawer.getByLabel("Changement de bannière toutes les")).toHaveValue("10");
      const card = drawer.locator("article", { hasText: "[FICTIVE] Campagne A" });
      await card.getByRole("button", { name: "Statistiques" }).click();
      await expect(drawer).toContainText("Affichages");
      await expect(drawer).toContainText("Aucune donnée personnelle");
      await drawer.getByRole("button", { name: "Nouvelle campagne", exact: true }).first().click();
      await expect(drawer).toContainText("heure de Kinshasa");
      await expect(drawer.getByLabel("Coordination", { exact: true })).not.toBeChecked();
    });
    await superAdmin.context.close();
  } finally {
    await browser?.close().catch(() => {});
    if (server) {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else server.kill();
    }
    if (step !== "retire") {
      try { await retire(s); record("Staging remis en état", "PASS"); }
      catch (error) { record("Staging remis en état", "FAIL", String(error.message).slice(0, 300)); process.exitCode = 1; }
      mkdirSync(output, { recursive: true });
      writeFileSync(`${output}/resultat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, JSON.stringify(results, null, 2));
    }
    await s.close();
  }
}

await run();
