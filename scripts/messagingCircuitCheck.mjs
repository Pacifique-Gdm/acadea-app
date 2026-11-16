// Vérification du circuit complet de la messagerie sur le STAGING (lot 23).
//
// Lancement (PowerShell, depuis Documents\AC) :
//   node .claude\worktrees\sweet-galileo-16823c\scripts\messagingCircuitCheck.mjs --base=https://<adresse staging>
// Le script lit LUI-MÊME les comptes de test dans .env.local (dossier courant) :
// variables E2E_<NOM>_EMAIL et E2E_<NOM>_PASSWORD. Aucun mot de passe, aucune
// adresse e-mail ni aucun jeton n'est affiché ou écrit : seuls le rôle et le
// nom de l'école apparaissent dans le rapport.
// Refus immédiat si l'application visée n'utilise pas le projet acadea-staging.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, getDoc, getFirestore, onSnapshot, query, updateDoc, where } from "firebase/firestore";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => { const [k, ...v] = arg.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : true]; }));
const BASE = String(args.base ?? "https://acadea-staging.vercel.app").replace(/\/$/, "");
const WAIT_MS = Number(args.wait ?? 15000);
const BADGE_MS = Number(args.badge ?? 10000);
const ENV_FILE = resolve(process.cwd(), String(args.env ?? ".env.local"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const ROLE_LABELS = { super_admin: "Super administrateur", coordination_admin: "Coordination", sub_coordination_admin: "Sous-coordination", school_admin: "Administrateur", secretary: "Secrétaire", cashier: "Caissier", study_director: "Directeur des études", discipline_director: "Directeur de discipline", teacher: "Enseignant", parent: "Parent" };
const HEADER_ROLE = { super_admin: "Super administrateur", coordination_admin: "Coordinateur", sub_coordination_admin: "Sous-coordinateur", school_admin: "Administrateur", secretary: "Secrétaire", cashier: "Caissier", study_director: "Directeur des études", discipline_director: "Directeur de Discipline", teacher: "Enseignant", parent: "Parent" };
const STAFF = ["school_admin", "cashier", "secretary", "discipline_director", "study_director", "teacher"];
// Chemins autorisés (aller) — décisions du propriétaire du 16/11 incluses.
const PATHS = [
  ...STAFF.flatMap((from) => [...STAFF.filter((to) => to !== from), "parent"].map((to) => [from, to])),
  ["school_admin", "coordination_admin"], ["school_admin", "sub_coordination_admin"],
  ...STAFF.map((to) => ["parent", to]),
  ...["coordination_admin", "sub_coordination_admin"].flatMap((from) => [...STAFF, "parent"].map((to) => [from, to])),
  ...["coordination_admin", "sub_coordination_admin", "school_admin"].map((to) => ["super_admin", to]),
];
// Le retour (réponse) est attendu partout, SAUF parent → Coordination / Sous-coordination (décision du propriétaire).
// Comptes parents de l'école de référence : en cas de limite (3 messages / 12 h par parent,
// réglage anti-abus à ne pas changer), le script essaie le parent suivant.
let parentPool = [];
const isQuota = (error) => /HTTP 429/.test(String(error?.message ?? ""));
const replyAllowed = (from, to) => !(to === "parent" && ["coordination_admin", "sub_coordination_admin"].includes(from));

function readEnvAccounts() {
  if (!existsSync(ENV_FILE)) throw new Error(`Fichier ${ENV_FILE} introuvable.`);
  const values = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return Object.keys(values).filter((key) => /^E2E_.+_EMAIL$/.test(key)).map((key) => key.slice(0, -"_EMAIL".length))
    .filter((prefix) => values[`${prefix}_PASSWORD`]).map((prefix) => ({ key: prefix, email: values[`${prefix}_EMAIL`], password: values[`${prefix}_PASSWORD`] }));
}

async function stagingFirebaseConfig() {
  const html = await (await fetch(`${BASE}/login`)).text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => new URL(match[1], BASE).href);
  for (const url of scripts) {
    const code = await (await fetch(url)).text();
    const pick = (name) => code.match(new RegExp(`${name}:"([^"]+)"`))?.[1];
    if (pick("projectId")) {
      const config = { apiKey: pick("apiKey"), authDomain: pick("authDomain"), projectId: pick("projectId"), storageBucket: pick("storageBucket"), messagingSenderId: pick("messagingSenderId"), appId: pick("appId") };
      if (config.projectId !== "acadea-staging") throw new Error(`Projet ${config.projectId} : refusé (staging uniquement).`);
      return config;
    }
  }
  throw new Error("Configuration Firebase introuvable dans l'application visée.");
}

async function login(config, account) {
  const app = initializeApp(config, `essai-${account.key}`);
  const auth = getAuth(app), db = getFirestore(app);
  const credential = await signInWithEmailAndPassword(auth, account.email, account.password);
  const uid = credential.user.uid;
  const profile = (await getDoc(doc(db, "users", uid))).data() ?? {};
  const role = profile.role === "admin" ? "school_admin" : profile.role;
  let schoolYearId = "", schoolName = "";
  if (profile.schoolId) {
    const school = (await getDoc(doc(db, "schools", profile.schoolId)).catch(() => undefined))?.data();
    schoolYearId = school?.activeSchoolYearId ?? ""; schoolName = school?.name ?? profile.schoolId;
  }
  return { key: account.key, app, auth, db, uid, role, profile, name: String(profile.name ?? profile.displayName ?? "").trim(), schoolId: profile.schoolId ?? "", schoolYearId, schoolName };
}

async function api(user, path, method, body) {
  const token = await user.auth.currentUser.getIdToken();
  const response = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} HTTP ${response.status} : ${payload.message ?? payload.error ?? "erreur"}`);
  return payload;
}

/** Écoute, comme l'application, les notifications non lues du destinataire. */
function watchUnread(user, schoolId, schoolYearId) {
  const state = { items: new Map(), errors: [] };
  const constraints = [where("recipientUserId", "==", user.uid), where("read", "==", false)];
  // Même forme de requête que l'application : école + année, ou message de plateforme.
  const scoped = schoolId && schoolYearId ? [where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)]
    : user.role === "super_admin" ? [] : [where("platformMessage", "==", true)];
  const unsubscribe = onSnapshot(query(collection(user.db, "notifications"), ...scoped, ...constraints),
    (snapshot) => { state.items = new Map(snapshot.docs.map((item) => [item.id, { ...item.data(), seenAt: state.items.get(item.id)?.seenAt ?? Date.now() }])); },
    (error) => state.errors.push(error.code ?? error.message));
  return { state, stop: unsubscribe };
}

async function waitFor(check, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const value = check(); if (value) return value; await sleep(250); }
  return undefined;
}

function headerOk(message, sender) {
  const looksTechnical = (value) => !value || value === sender.uid || /^[A-Za-z0-9_-]{20,}$/.test(value) || value === "Utilisateur administratif";
  return message && message.senderId === sender.uid && !looksTechnical(String(message.senderName ?? "").trim())
    && (sender.role === "parent" || message.senderRole === sender.role || (message.senderRole === "admin" && sender.role === "school_admin"));
}

async function send(sender, recipients, subject, replyTo) {
  const ids = recipients.map((item) => item.uid), roles = [...new Set(recipients.map((item) => item.role))];
  const body = `${subject} — message automatique de vérification (lot 23).`;
  // 12 points d'entrée au maximum (forfait Vercel) : le Super administrateur passe par message-recipients.
  if (sender.role === "super_admin") return api(sender, "/api/message-recipients", "POST", { action: "send", recipientIds: ids, subject, body, ...(replyTo ? { replyToMessageId: replyTo } : {}) });
  if (["coordination_admin", "sub_coordination_admin"].includes(sender.role)) return api(sender, "/api/coordination-message-recipients", "POST", { recipientIds: ids, subject, body, ...(replyTo ? { replyToMessageId: replyTo } : {}) });
  if (sender.role === "parent") return api(sender, "/api/send-parent-message", "POST", { schoolYearId: sender.schoolYearId, recipientIds: ids, subject, body });
  return api(sender, "/api/send-school-message", "POST", { schoolYearId: sender.schoolYearId, recipientIds: ids, recipientRoles: roles, subject, body, draftId: randomUUID(), attachments: [], ...(replyTo ? { replyToMessageId: replyTo } : {}) });
}

function messageIdsFrom(result) {
  return [result?.message?.id, ...(result?.messageIds ?? []), ...(result?.messages ?? []).map((item) => item.id)].filter(Boolean);
}

/** Un envoi (un message vers plusieurs destinataires) puis contrôle de chaque destinataire. */
async function checkSend(initialSender, recipients, label, observer, replyTo) {
  let sender = initialSender;
  const rows = new Map(recipients.map((recipient) => [recipient.uid, { arrive: "non", entete: "non", badge: "non", lu: "non", cause: "" }]));
  // Destinataire d'école : son école et son année. Coordination : l'école de l'expéditeur.
  // Super administrateur, ou message venant de la plateforme : notifications de plateforme.
  const scopeOf = (recipient) => recipient.schoolId ? [recipient.schoolId, recipient.schoolYearId]
    : sender.schoolId && recipient.role !== "super_admin" ? [sender.schoolId, sender.schoolYearId] : [];
  const watches = new Map(recipients.map((recipient) => [recipient.uid, watchUnread(recipient, ...scopeOf(recipient))]));
  const observerWatch = observer ? watchUnread(observer, observer.schoolId, observer.schoolYearId) : undefined;
  await sleep(1500);
  const sentAt = Date.now();
  let messageIds = [];
  const candidates = sender.role === "parent" ? [sender, ...parentPool.filter((item) => item.uid !== sender.uid)] : [sender];
  for (const candidate of candidates) {
    try { messageIds = messageIdsFrom(await send(candidate, recipients, `[Essai circuit] ${label}`, replyTo)); sender = candidate; for (const row of rows.values()) row.cause = ""; break; }
    catch (error) {
      const quota = isQuota(error) && candidate.role === "parent";
      for (const row of rows.values()) { row.cause = quota ? "limite atteinte : 3 messages par 12 h pour le(s) compte(s) parent de test (réglage anti-abus, pas un défaut)" : `envoi refusé : ${error.message}`; if (quota) { row.arrive = row.entete = row.badge = row.lu = "limite"; } }
      if (!quota) break;
    }
  }
  for (const recipient of recipients) {
    const row = rows.get(recipient.uid), watch = watches.get(recipient.uid);
    if (row.cause || !messageIds.length) continue;
    const notification = await waitFor(() => [...watch.state.items.entries()].find(([, item]) => messageIds.includes(item.messageId) || (item.createdAt && Date.parse(item.createdAt) >= sentAt - 2000 && String(item.body ?? "").includes(label))), WAIT_MS);
    if (!notification) { row.cause = watch.state.errors.length ? `écoute refusée (${watch.state.errors[0]})` : "aucune notification reçue"; continue; }
    const [notificationId, item] = notification;
    row.badge = item.seenAt - sentAt <= BADGE_MS ? "oui" : `non (${Math.round((item.seenAt - sentAt) / 1000)} s)`;
    const message = item.messageId ? (await getDoc(doc(recipient.db, "messages", item.messageId)).catch((error) => ({ data: () => undefined, error }))).data() : undefined;
    row.arrive = message ? "oui" : "non";
    if (!message) row.cause = "message illisible par le destinataire";
    row.entete = headerOk(message, sender) ? "oui" : "non";
    if (message && row.entete === "non") row.cause = `en-tête : nom « ${message.senderName ?? "absent"} », rôle « ${message.senderRole ?? "absent"} »`;
    row.messageId = item.messageId;
    try { await updateDoc(doc(recipient.db, "notifications", notificationId), { read: true }); } catch (error) { row.cause ||= `lecture non enregistrée (${error.code})`; }
    row.lu = (await waitFor(() => !watch.state.items.has(notificationId), BADGE_MS)) ? "oui" : "non";
    if (row.lu === "non") row.cause ||= "le badge ne disparaît pas après lecture";
  }
  if (observerWatch && messageIds.length) {
    const leaked = [...observerWatch.state.items.values()].some((item) => messageIds.includes(item.messageId));
    const readable = await Promise.all(messageIds.map((id) => getDoc(doc(observer.db, "messages", id)).then((snapshot) => snapshot.exists(), () => false)));
    if (leaked || readable.some(Boolean)) for (const row of rows.values()) { row.arrive = "non"; row.cause = `fuite : visible par ${ROLE_LABELS[observer.role]} (${observer.schoolName})`; }
  }
  watches.forEach((watch) => watch.stop()); observerWatch?.stop();
  return rows;
}

async function main() {
  const accounts = readEnvAccounts();
  if (!accounts.length) throw new Error("Aucun compte E2E_<NOM>_EMAIL / _PASSWORD trouvé dans .env.local.");
  const config = await stagingFirebaseConfig();
  const users = [];
  for (const account of accounts) {
    try { users.push(await login(config, account)); } catch (error) { console.log(`Compte ${account.key} : connexion impossible (${error.code ?? "erreur"}).`); }
  }
  console.log(`Connectés : ${users.map((user) => `${ROLE_LABELS[user.role] ?? user.role} (${user.schoolName || "plateforme"})`).join(", ")}`);
  // Écoles réellement supervisées par chaque compte de Coordination / Sous-coordination
  // (lecture de sa propre liste de destinataires) : jamais d'appariement au hasard.
  const coverage = new Map();
  for (const user of users.filter((item) => ["coordination_admin", "sub_coordination_admin"].includes(item.role))) {
    try { coverage.set(user.uid, new Set((await api(user, "/api/coordination-message-recipients", "GET")).recipients.map((item) => item.schoolId))); }
    catch { coverage.set(user.uid, new Set()); }
  }
  // École de référence : le plus de rôles de test, puis Coordination ET Sous-coordination qui la supervisent.
  const schools = [...new Set(users.map((user) => user.schoolId).filter(Boolean))];
  const score = (id) => users.filter((user) => user.schoolId === id).length
    + (users.some((user) => user.role === "coordination_admin" && coverage.get(user.uid)?.has(id)) ? 5 : 0)
    + (users.some((user) => user.role === "sub_coordination_admin" && coverage.get(user.uid)?.has(id)) ? 5 : 0);
  const schoolId = schools.sort((a, b) => score(b) - score(a))[0];
  const byRole = new Map();
  for (const user of users) {
    if (user.schoolId && user.schoolId !== schoolId) continue;
    if (["coordination_admin", "sub_coordination_admin"].includes(user.role) && !coverage.get(user.uid)?.has(schoolId)) continue;
    if (!byRole.has(user.role)) byRole.set(user.role, user);
  }
  const observer = users.find((user) => user.schoolId && user.schoolId !== schoolId);
  parentPool = users.filter((user) => user.role === "parent" && user.schoolId === schoolId);
  const results = [];
  const senders = [...new Set(PATHS.map(([from]) => from))];
  for (const from of senders) {
    const sender = byRole.get(from);
    const targets = PATHS.filter(([f]) => f === from).map(([, to]) => to);
    if (!sender) { targets.forEach((to) => results.push({ from, to, missing: `compte ${ROLE_LABELS[from]} absent de .env.local` })); continue; }
    const recipients = targets.map((to) => byRole.get(to)).filter(Boolean);
    targets.filter((to) => !byRole.has(to)).forEach((to) => results.push({ from, to, missing: `compte ${ROLE_LABELS[to]} absent de .env.local` }));
    if (!recipients.length) continue;
    // Petits groupes : un destinataire refusé ne masque jamais les autres chemins.
    const groups = [recipients.filter((item) => item.schoolId), ...recipients.filter((item) => !item.schoolId).map((item) => [item])].filter((group) => group.length);
    for (const group of groups) {
      const rows = await checkSend(sender, group, `${ROLE_LABELS[from]} vers ${group.map((item) => ROLE_LABELS[item.role]).join(", ")}`, observer);
      for (const recipient of group) results.push({ from, to: recipient.role, aller: rows.get(recipient.uid), sender, recipient });
      await sleep(2500);
    }
  }
  // Retour : chaque destinataire répond à l'expéditeur (le parent répond en un seul message, quota de 3 par 12 h).
  const parentReplies = results.filter((row) => row.to === "parent" && row.aller?.arrive === "oui" && replyAllowed(row.from, row.to));
  for (const row of results.filter((item) => item.aller?.arrive === "oui" && item.to !== "parent")) {
    if (!replyAllowed(row.from, row.to)) { row.retour = { arrive: "—", entete: "—", badge: "—", lu: "—", cause: "réponse non prévue" }; continue; }
    const rows = await checkSend(row.recipient, [row.sender], `Réponse ${ROLE_LABELS[row.to]} vers ${ROLE_LABELS[row.from]}`, observer, row.aller.messageId);
    row.retour = rows.get(row.sender.uid);
    await sleep(1200);
  }
  if (parentReplies.length) {
    const parent = byRole.get("parent");
    const targets = parentReplies.filter((row) => STAFF.includes(row.from)).map((row) => row.sender);
    const rows = targets.length ? await checkSend(parent, targets, "Réponse Parent vers personnels", observer) : new Map();
    for (const row of parentReplies) row.retour = rows.get(row.sender.uid) ?? { arrive: "—", entete: "—", badge: "—", lu: "—", cause: "réponse non prévue (Coordination)" };
  }
  for (const row of results.filter((item) => item.to === "parent" && !item.retour && item.aller)) row.retour = { arrive: "—", entete: "—", badge: "—", lu: "—", cause: replyAllowed(row.from, row.to) ? "aller en échec" : "réponse non autorisée (décision)" };

  const cell = (part, key) => part ? part[key] : "—";
  const lines = [`# Vérification du circuit des messages — ${new Date().toISOString()}`, "", `Application : ${BASE} · école de référence : ${users.find((user) => user.schoolId === schoolId)?.schoolName ?? "?"} · isolation contrôlée avec : ${observer ? `${ROLE_LABELS[observer.role]} (${observer.schoolName})` : "aucun compte d'une autre école"}`, "",
    "| Chemin | Arrive | En-tête | Badge immédiat | Badge disparaît | Retour arrive | Retour en-tête | Retour badge | Cause |", "|---|---|---|---|---|---|---|---|---|"];
  for (const row of results) {
    const cause = row.missing ?? [row.aller?.cause, row.retour?.cause && row.retour.cause !== "réponse non prévue" ? `retour : ${row.retour.cause}` : ""].filter(Boolean).join(" ; ");
    lines.push(`| ${ROLE_LABELS[row.from]} → ${ROLE_LABELS[row.to]} | ${cell(row.aller, "arrive")} | ${cell(row.aller, "entete")} | ${cell(row.aller, "badge")} | ${cell(row.aller, "lu")} | ${cell(row.retour, "arrive")} | ${cell(row.retour, "entete")} | ${cell(row.retour, "badge")} | ${cause || ""} |`);
  }
  const out = resolve(process.cwd(), "tmp"); mkdirSync(out, { recursive: true });
  const file = resolve(out, `circuit-messages-${Date.now()}.md`);
  writeFileSync(file, lines.join("\n"));
  console.log(lines.join("\n"));
  console.log(`\nRapport écrit : ${file}`);
  for (const user of users) { await signOut(user.auth).catch(() => {}); await deleteApp(user.app).catch(() => {}); }
}

main().then(() => process.exit(0)).catch((error) => { console.error(`ARRÊT : ${error.message}`); process.exit(1); });
