// Essai des notifications push sur le STAGING (lot 24), sans téléphone.
//
// Lancement (PowerShell, depuis Documents\AC) :
//   node .claude\worktrees\sweet-galileo-16823c\tmp\verification\pushStagingCheck.mjs
// Le script lit lui-même les comptes E2E_<NOM>_EMAIL / _PASSWORD de .env.local
// (rien n'est affiché). Principe : chaque compte enregistre un « appareil d'essai »
// au jeton volontairement invalide. Quand un message lui est envoyé, la fonction
// push doit tenter l'envoi vers CET appareil, constater que le jeton est invalide
// et le supprimer. Appareil supprimé = push tenté vers le bon destinataire ;
// appareil d'un autre compte intact = séparation respectée. Les appareils d'essai
// restants sont retirés à la fin. Staging uniquement.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { deleteDoc, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

const BASE = "https://acadea-staging.vercel.app";
const ENV_FILE = resolve(process.cwd(), ".env.local");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const LABELS = { super_admin: "Super administrateur", coordination_admin: "Coordination", sub_coordination_admin: "Sous-coordination", school_admin: "Administrateur", secretary: "Secrétaire", cashier: "Caissier", study_director: "Directeur des études", discipline_director: "Directeur de discipline", teacher: "Enseignant", parent: "Parent" };

function accounts() {
  if (!existsSync(ENV_FILE)) throw new Error(".env.local introuvable dans le dossier courant.");
  const values = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2"); }
  return Object.keys(values).filter((k) => /^E2E_.+_EMAIL$/.test(k)).map((k) => k.slice(0, -6)).filter((p) => values[`${p}_PASSWORD`]).map((p) => ({ key: p, email: values[`${p}_EMAIL`], password: values[`${p}_PASSWORD`] }));
}
async function config() {
  const html = await (await fetch(`${BASE}/login`)).text();
  for (const src of [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => new URL(m[1], BASE).href)) {
    const code = await (await fetch(src)).text(); const pick = (n) => code.match(new RegExp(`${n}:"([^"]+)"`))?.[1];
    if (pick("projectId")) { if (pick("projectId") !== "acadea-staging") throw new Error("Projet refusé : staging uniquement."); return { apiKey: pick("apiKey"), authDomain: pick("authDomain"), projectId: pick("projectId"), appId: pick("appId") }; }
  }
  throw new Error("Configuration Firebase introuvable.");
}
async function login(cfg, account) {
  const app = initializeApp(cfg, `push-${account.key}`); const auth = getAuth(app), db = getFirestore(app);
  const uid = (await signInWithEmailAndPassword(auth, account.email, account.password)).user.uid;
  const profile = (await getDoc(doc(db, "users", uid))).data() ?? {};
  const school = profile.schoolId ? (await getDoc(doc(db, "schools", profile.schoolId)).catch(() => undefined))?.data() : undefined;
  return { app, auth, db, uid, role: profile.role === "admin" ? "school_admin" : profile.role, schoolId: profile.schoolId ?? "", schoolYearId: school?.activeSchoolYearId ?? "", schoolName: school?.name ?? "" };
}
async function api(user, path, method, body) {
  const token = await user.auth.currentUser.getIdToken();
  const response = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status} ${payload.message ?? payload.error ?? ""}`);
  return payload;
}
const DEVICE = "essai-lot24";
async function plantDevice(user) {
  const now = new Date().toISOString();
  await setDoc(doc(user.db, "users", user.uid, "pushTokens", DEVICE), { userId: user.uid, deviceId: DEVICE, token: `jeton-essai-invalide-${randomUUID()}`, platform: "web", active: true, createdAt: now, updatedAt: now });
}
const deviceGone = async (user) => !(await getDoc(doc(user.db, "users", user.uid, "pushTokens", DEVICE))).exists();

async function main() {
  const cfg = await config();
  const users = [];
  for (const account of accounts()) { try { users.push(await login(cfg, account)); } catch { console.log(`Compte ${account.key} : connexion impossible.`); } }
  const covered = new Map();
  for (const user of users.filter((u) => ["coordination_admin", "sub_coordination_admin"].includes(u.role))) {
    try { covered.set(user.uid, new Set((await api(user, "/api/coordination-message-recipients", "GET")).recipients.map((r) => r.schoolId))); } catch { covered.set(user.uid, new Set()); }
  }
  // École de référence : le plus de comptes, puis une Coordination ET une Sous-coordination qui la supervisent.
  const score = (id) => users.filter((u) => u.schoolId === id).length
    + (users.some((u) => u.role === "coordination_admin" && covered.get(u.uid)?.has(id)) ? 5 : 0)
    + (users.some((u) => u.role === "sub_coordination_admin" && covered.get(u.uid)?.has(id)) ? 5 : 0);
  const schoolId = [...new Set(users.map((u) => u.schoolId).filter(Boolean))].sort((a, b) => score(b) - score(a))[0];
  const pick = (role) => users.find((u) => u.role === role && (u.schoolId ? u.schoolId === schoolId : !["coordination_admin", "sub_coordination_admin"].includes(role) || covered.get(u.uid)?.has(schoolId)));
  const observer = users.find((u) => u.schoolId && u.schoolId !== schoolId);
  const cases = [
    ["secretary", "teacher", (s, r) => api(s, "/api/send-school-message", "POST", { schoolYearId: s.schoolYearId, recipientIds: [r.uid], recipientRoles: [r.role], subject: "[Essai push] message", body: "Essai automatique du lot 24.", draftId: randomUUID(), attachments: [] })],
    ["cashier", "parent", (s, r) => api(s, "/api/send-school-message", "POST", { schoolYearId: s.schoolYearId, recipientIds: [r.uid], recipientRoles: [r.role], subject: "[Essai push] message", body: "Essai automatique du lot 24.", draftId: randomUUID(), attachments: [] })],
    ["parent", "school_admin", (s, r) => api(s, "/api/send-parent-message", "POST", { schoolYearId: s.schoolYearId, recipientIds: [r.uid], subject: "[Essai push] message", body: "Essai automatique du lot 24." })],
    ["coordination_admin", "school_admin", (s, r) => api(s, "/api/coordination-message-recipients", "POST", { recipientIds: [r.uid], subject: "[Essai push] message", body: "Essai automatique du lot 24." })],
    ["sub_coordination_admin", "secretary", (s, r) => api(s, "/api/coordination-message-recipients", "POST", { recipientIds: [r.uid], subject: "[Essai push] message", body: "Essai automatique du lot 24." })],
    ["super_admin", "coordination_admin", (s, r) => api(s, "/api/message-recipients", "POST", { action: "send", recipientIds: [r.uid], subject: "[Essai push] message", body: "Essai automatique du lot 24." })],
  ];
  const rows = [];
  for (const [fromRole, toRole, send] of cases) {
    const sender = pick(fromRole), recipient = pick(toRole);
    if (!sender || !recipient) { rows.push(`| ${LABELS[fromRole]} → ${LABELS[toRole]} | — | — | compte absent de .env.local |`); continue; }
    await plantDevice(recipient); if (observer) await plantDevice(observer);
    let cause = "";
    try { await send(sender, recipient); } catch (error) { cause = `envoi refusé : ${error.message}`; }
    const reached = cause ? false : Boolean(await (async () => { for (let i = 0; i < 60; i++) { if (await deviceGone(recipient)) return true; await sleep(1000); } return false; })());
    const isolated = observer ? !(await deviceGone(observer)) : null;
    if (!cause && !reached) cause = "aucun envoi push constaté en 60 s (fonction non publiée ?)";
    rows.push(`| ${LABELS[fromRole]} → ${LABELS[toRole]} | ${reached ? "oui" : "non"} | ${isolated === null ? "non vérifiable" : isolated ? "oui" : "non (fuite)"} | ${cause} |`);
  }
  for (const user of users) { await deleteDoc(doc(user.db, "users", user.uid, "pushTokens", DEVICE)).catch(() => {}); }
  const lines = [`# Essai des notifications push — ${new Date().toISOString()}`, "", `Application : ${BASE} · isolation contrôlée avec : ${observer ? `${LABELS[observer.role]} (${observer.schoolName})` : "aucun compte d'une autre école"}`, "", "| Chemin | Push envoyé au destinataire | Autre école non touchée | Cause |", "|---|---|---|---|", ...rows];
  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const file = resolve(process.cwd(), "tmp", `essai-push-${Date.now()}.md`);
  writeFileSync(file, lines.join("\n")); console.log(lines.join("\n")); console.log(`\nRapport écrit : ${file}`);
  for (const user of users) { await signOut(user.auth).catch(() => {}); await deleteApp(user.app).catch(() => {}); }
}
main().then(() => process.exit(0)).catch((error) => { console.error(`ARRÊT : ${error.message}`); process.exit(1); });
