// Lot SA-2 : construction de la liste de recherche des écoles pour les écoles déjà existantes.
//   TOKEN=$(gcloud auth print-access-token) node scripts/schoolSearchIndexBackfill.mjs <projet> <étape> [--confirmer]
// projet : acadea-staging ou acadea-production (toujours le staging d'abord).
// étapes :
//   mesurer        lecture seule : écoles, taille prévue de chaque partie, état actuel de la liste ;
//   sauvegarder    copie de la liste actuelle dans diagnostics/school-search-index/ (souvent vide) ;
//   construire     écrit les 16 parties (avec --confirmer ; sinon essai à blanc) ;
//   verifier       recalcule tout en mémoire et compare avec ce qui est rangé ;
//   retour-arriere remet la dernière sauvegarde (avec --confirmer) : parties absentes de la sauvegarde effacées.
// Les écoles elles-mêmes ne sont jamais modifiées.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { SCHOOL_SEARCH_COLLECTION, SCHOOL_SEARCH_PARTS, schoolSearchEntry, schoolSearchPart } from "../api/_lib/schoolSearchIndex.js";

const [projectId, step, flag] = process.argv.slice(2);
const confirmed = flag === "--confirmer";
if (!["acadea-staging", "acadea-production"].includes(projectId)) throw new Error("Projet : acadea-staging ou acadea-production.");
if (!process.env.TOKEN) throw new Error("Lancez d'abord : TOKEN=$(gcloud auth print-access-token)");
const USER_ROLES = ["school_admin", "parent", "cashier", "discipline_director", "secretary"];
const backupDir = "diagnostics/school-search-index";

const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: process.env.TOKEN });
const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });

async function buildParts({ withUsers }) {
  const schools = await db.collection("schools").get();
  const parts = Object.fromEntries(Array.from({ length: SCHOOL_SEARCH_PARTS }, (_, index) => [`part-${String(index).padStart(2, "0")}`, {}]));
  for (const doc of schools.docs) {
    const entry = schoolSearchEntry(doc.data());
    if (!entry) continue;
    if (withUsers) entry.u = (await db.collection("users").where("schoolId", "==", doc.id).where("role", "in", USER_ROLES).count().get()).data().count;
    parts[schoolSearchPart(doc.id)][doc.id] = entry;
  }
  return { schools: schools.size, parts };
}

async function storedParts() {
  const snapshot = await db.collection(SCHOOL_SEARCH_COLLECTION).get();
  return Object.fromEntries(snapshot.docs.map((doc) => [doc.id, doc.data()]));
}

const size = (value) => Buffer.byteLength(JSON.stringify(value));

try {
  if (step === "mesurer") {
    const { schools, parts } = await buildParts({ withUsers: false });
    const sizes = Object.values(parts).map(size);
    const stored = await storedParts();
    console.log(JSON.stringify({ projectId, ecoles: schools, lignes: Object.values(parts).reduce((n, p) => n + Object.keys(p).length, 0),
      partieMaxKo: Math.round(Math.max(...sizes) / 1024), totalKo: Math.round(sizes.reduce((a, b) => a + b, 0) / 1024),
      listeActuelle: { parties: Object.keys(stored).length, lignes: Object.values(stored).reduce((n, p) => n + Object.keys(p.entries ?? {}).length, 0) } }));
  } else if (step === "sauvegarder") {
    mkdirSync(backupDir, { recursive: true });
    const file = `${backupDir}/${projectId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const stored = await storedParts();
    writeFileSync(file, JSON.stringify({ projectId, at: new Date().toISOString(), parts: stored }, null, 1));
    console.log(`Sauvegarde : ${file} (${Object.keys(stored).length} partie(s)).`);
  } else if (step === "construire") {
    const backups = existsSync(backupDir) ? readdirSync(backupDir).filter((name) => name.startsWith(projectId)) : [];
    if (!backups.length) throw new Error("Faites d'abord l'étape « sauvegarder ».");
    const { schools, parts } = await buildParts({ withUsers: true });
    const at = new Date().toISOString();
    for (const [part, entries] of Object.entries(parts)) {
      const doc = { entries, updatedAt: at, usersCountedAt: at };
      if (size(doc) > 900_000) throw new Error(`${part} trop grande (${Math.round(size(doc) / 1024)} Ko) : augmentez le nombre de parties.`);
      if (confirmed) await db.doc(`${SCHOOL_SEARCH_COLLECTION}/${part}`).set(doc);
    }
    console.log(`${confirmed ? "Liste construite" : "Essai à blanc (rien écrit)"} : ${schools} école(s), ${Object.values(parts).reduce((n, p) => n + Object.keys(p).length, 0)} ligne(s), ${SCHOOL_SEARCH_PARTS} partie(s).`);
  } else if (step === "verifier") {
    const { parts } = await buildParts({ withUsers: false });
    const stored = await storedParts();
    const problems = [];
    for (const [part, entries] of Object.entries(parts)) {
      const have = stored[part]?.entries ?? {};
      for (const [id, entry] of Object.entries(entries)) {
        const { u: _users, ...rest } = have[id] ?? {};
        if (JSON.stringify(rest) !== JSON.stringify(entry)) problems.push(`${part}/${id} : ${have[id] ? "différente" : "absente"}`);
      }
      for (const id of Object.keys(have)) if (!entries[id]) problems.push(`${part}/${id} : en trop`);
    }
    console.log(problems.length ? `Écarts : ${problems.length}\n${problems.slice(0, 20).join("\n")}` : "Liste conforme : chaque école a sa ligne exacte, aucune ligne en trop.");
    if (problems.length) process.exitCode = 1;
  } else if (step === "retour-arriere") {
    const backups = existsSync(backupDir) ? readdirSync(backupDir).filter((name) => name.startsWith(projectId)).sort() : [];
    if (!backups.length) throw new Error("Aucune sauvegarde.");
    const backup = JSON.parse(readFileSync(`${backupDir}/${backups.at(-1)}`, "utf8"));
    const stored = await storedParts();
    const toDelete = Object.keys(stored).filter((part) => !backup.parts[part]);
    console.log(`Sauvegarde ${backups.at(-1)} : ${Object.keys(backup.parts).length} partie(s) à remettre, ${toDelete.length} à effacer.`);
    if (confirmed) {
      for (const part of toDelete) await db.doc(`${SCHOOL_SEARCH_COLLECTION}/${part}`).delete();
      for (const [part, data] of Object.entries(backup.parts)) await db.doc(`${SCHOOL_SEARCH_COLLECTION}/${part}`).set(data);
      console.log("Retour arrière fait.");
    } else console.log("Essai à blanc : rien n'a été changé. Ajoutez --confirmer.");
  } else {
    console.log("Étapes : mesurer | sauvegarder | construire [--confirmer] | verifier | retour-arriere [--confirmer]");
  }
} finally {
  await db.terminate();
}
