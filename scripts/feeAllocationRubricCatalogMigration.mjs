#!/usr/bin/env node
// Lot 27b — migration d'une école qui a déjà une répartition vers le catalogue des rubriques.
// Simulation (aucune écriture) :  node scripts/feeAllocationRubricCatalogMigration.mjs --project=acadea-production --school=<id>
// Migration (après accord)    :  … --apply
// Crée seulement : la marque « catalogue en service » de l'école et de l'année, et une fiche par rubrique
// existante (MÊMES identifiants, MÊMES noms). Ne modifie ni n'efface aucun paiement, mouvement, solde ou version.
// Lecture avec le jeton gcloud de la personne qui lance (variable TOKEN), comme les autres scripts de vérification.
import { Firestore } from "@google-cloud/firestore";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

const arg = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const projectId = arg("project"), schoolId = arg("school"), apply = process.argv.includes("--apply");
if (!["acadea-production", "acadea-staging"].includes(projectId) || !schoolId) {
  console.error("Usage : TOKEN=$(gcloud auth print-access-token) node scripts/feeAllocationRubricCatalogMigration.mjs --project=acadea-staging|acadea-production --school=<id> [--apply]");
  process.exit(1);
}
const authClient = new OAuth2Client({ quotaProjectId: projectId });
authClient.setCredentials({ access_token: process.env.TOKEN });
const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
const key = (name) => String(name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");

const checks = []; const ok = (label, pass, detail = "") => checks.push({ label, pass, detail });
const school = (await db.doc(`schools/${schoolId}`).get()).data();
const states = (await db.collection("feeAllocationStates").where("schoolId", "==", schoolId).get()).docs.map((doc) => doc.data());
const state = states.find((item) => item.schoolYearId === school?.activeSchoolYearId);
ok("École trouvée, avec une répartition sur l'année active", Boolean(school && state), state ? `${school.name} · ${state.schoolYearId} · ${state.currency} · ${state.status}` : "aucune");
if (!state) { report(); process.exit(1); }
const yearId = state.schoolYearId;
const marker = await db.doc(`feeAllocationRubricCatalogs/${schoolId}__${yearId}`).get();
const existing = await db.collection("feeAllocationRubrics").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get();
ok("Pas encore de catalogue pour cette année (aucun écrasement possible)", !marker.exists && existing.empty, `marque : ${marker.exists ? "oui" : "non"}, fiches : ${existing.size}`);
const rubrics = (state.rubrics ?? []).map((r) => ({ id: r.id, name: String(r.name ?? "").trim(), hidden: r.active === false }));
ok("Identifiants des rubriques valides (32 caractères)", rubrics.length > 0 && rubrics.every((r) => /^[a-f0-9]{32}$/.test(r.id)), `${rubrics.length} rubrique(s)`);
ok("Noms non vides et sans doublon", rubrics.every((r) => r.name && key(r.name) !== key("Non affecté")) && new Set(rubrics.map((r) => key(r.name))).size === rubrics.length, rubrics.map((r) => r.name).join(", "));
const known = new Set([...rubrics.map((r) => r.id), "UNALLOCATED"]);
const [versions, configs, balances] = await Promise.all([
  db.collection("feeAllocationVersions").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get(),
  db.collection("feeAllocationConfigs").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get(),
  db.collection("feeAllocationBalances").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", yearId).get(),
]);
const used = [...versions.docs.flatMap((d) => (d.data().rubrics ?? []).map((r) => r.id)), ...configs.docs.flatMap((d) => (d.data().draft?.rubrics ?? []).map((r) => r.id)), ...balances.docs.map((d) => d.data().rubricId)];
const unknown = [...new Set(used.filter((rubricId) => !known.has(rubricId)))];
ok("Versions, brouillons et soldes n'utilisent que ces rubriques (ou « Non affecté »)", unknown.length === 0, unknown.length ? `inconnues : ${unknown.join(", ")}` : `${versions.size} version(s), ${configs.size} configuration(s), ${balances.size} solde(s)`);
const now = new Date().toISOString();
const writes = [
  { path: `feeAllocationRubricCatalogs/${schoolId}__${yearId}`, data: { schoolId, schoolYearId: yearId, enabledAt: now, enabledBy: "migration-lot-27b" } },
  ...rubrics.map((r) => ({ path: `feeAllocationRubrics/${r.id}`, data: { id: r.id, schoolId, schoolYearId: yearId, name: r.name, hidden: r.hidden, createdAt: now, updatedAt: now, createdBy: "migration-lot-27b" } })),
];
report();
if (!checks.every((check) => check.pass)) { console.log("\nSIMULATION NON PROPRE : aucune écriture."); process.exit(1); }
if (!apply) { console.log("\nSIMULATION PROPRE : aucune écriture faite (ajoutez --apply pour migrer)."); process.exit(0); }
await db.runTransaction(async (transaction) => {
  const recheck = await transaction.get(db.doc(writes[0].path));
  if (recheck.exists) throw new Error("Un catalogue a été créé entre-temps : arrêt.");
  for (const write of writes) transaction.create(db.doc(write.path), write.data);
});
const after = await db.collection("feeAllocationRubrics").where("schoolId", "==", schoolId).where("schoolYearId", "==", yearId).get();
console.log(`\nMIGRATION FAITE : ${writes.length} fiche(s) créée(s) ; catalogue relu : ${after.size} rubrique(s) — ${after.docs.map((d) => d.data().name).join(", ")}.`);
await db.terminate();

function report() {
  console.log(`# Migration vers le catalogue des rubriques — ${projectId} — ${apply ? "MIGRATION" : "SIMULATION"}`);
  for (const check of checks) console.log(`${check.pass ? "OK    " : "ÉCHEC "} ${check.label}${check.detail ? ` — ${check.detail}` : ""}`);
  if (typeof writes !== "undefined") { console.log("\nÉcritures prévues (création uniquement) :"); for (const write of writes) console.log(`- ${write.path}${write.data.name ? ` : « ${write.data.name} »${write.data.hidden ? " (masquée)" : ""}` : " (marque du catalogue)"}`); }
}
