import { coordinationHttpError } from "./coordination.js";

/** Lot 7 — modèle commun de répartition de la Coordination (étude du 25/11/2026, réponses de l'utilisateur).
 * - Seul le Coordinateur (coordination_admin) lit et publie le modèle de SA coordination, par le serveur uniquement :
 *   aucune règle Firestore n'ouvre ces documents au navigateur (aucune nouvelle règle de sécurité).
 * - Le modèle ne contient AUCUNE donnée d'école (ni élèves, ni paiements, ni soldes) : seulement des noms de rubriques,
 *   de sous-rubriques, de types de frais et des pourcentages.
 * - Pourcentages seulement (les écoles d'une coordination n'ont pas toutes la même monnaie) ; le reste va dans
 *   « Non affecté » de l'école.
 * - Chaque publication crée une version numérotée (copie figée) et une ligne d'Historique. Une école n'est jamais
 *   modifiée par le modèle : elle l'utilisera au lot 8 (« Utiliser le modèle », pré-remplissage à vérifier). */
export const TEMPLATE_COLLECTION = "coordinationAllocationTemplates";
export const TEMPLATE_LIMITS = Object.freeze({ rubrics: 30, subRubrics: 20, feeTypes: 30 });
const ID_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
const fail = (message, status = 400, code = "invalid-argument") => { throw coordinationHttpError(status, code, message); };
const cleanText = (value) => (typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ") : "");
export const templateNameKey = (value) => cleanText(value).toLocaleLowerCase("fr");
const isReserved = (name) => templateNameKey(name).startsWith(templateNameKey("Non affecté"));

function cleanName(value, label, max) {
  const name = cleanText(value);
  if (!name || name.length > max) fail(`${label} : de 1 à ${max} caractères.`);
  if (isReserved(name)) fail(`« Non affecté » est réservé : choisissez un autre nom (${label.toLowerCase()}).`);
  return name;
}
function cleanId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(`Identifiant invalide (${label}).`);
  return value;
}
function cleanBasisPoints(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 10000) fail(`${label} : pourcentage entre 0,01 % et 100 %.`);
  return value;
}
function uniqueNames(items, label) {
  const keys = items.map((item) => templateNameKey(item.name ?? item.label));
  if (new Set(keys).size !== keys.length) fail(`Deux ${label} portent le même nom.`);
}
function cleanAllocations(value, rubricIds, label) {
  if (!Array.isArray(value)) fail(`Répartition invalide (${label}).`);
  const allocations = value.map((line) => ({ rubricId: cleanId(line?.rubricId, label), basisPoints: cleanBasisPoints(line?.basisPoints, label) }));
  if (allocations.some((line) => !rubricIds.has(line.rubricId))) fail(`Rubrique inconnue dans la répartition « ${label} ».`);
  if (new Set(allocations.map((line) => line.rubricId)).size !== allocations.length) fail(`Une rubrique est en double dans « ${label} ».`);
  if (allocations.reduce((sum, line) => sum + line.basisPoints, 0) > 10000) fail(`« ${label} » dépasse 100 %.`);
  return allocations;
}

/** Valide et normalise un modèle envoyé par l'écran. Lève une erreur 400 claire en français. */
export function validateAllocationTemplate(input) {
  const name = cleanName(input?.name, "Nom du modèle", 80);
  if (!Array.isArray(input?.rubrics) || input.rubrics.length < 1 || input.rubrics.length > TEMPLATE_LIMITS.rubrics) fail(`Le modèle doit avoir de 1 à ${TEMPLATE_LIMITS.rubrics} rubriques.`);
  const rubrics = input.rubrics.map((rubric) => {
    const rubricName = cleanName(rubric?.name, "Nom de rubrique", 80);
    const raw = rubric?.subRubrics ?? [];
    if (!Array.isArray(raw) || raw.length > TEMPLATE_LIMITS.subRubrics) fail(`Au plus ${TEMPLATE_LIMITS.subRubrics} sous-rubriques par rubrique.`);
    const subRubrics = raw.map((sub) => ({ id: cleanId(sub?.id, "sous-rubrique"), name: cleanName(sub?.name, "Nom de sous-rubrique", 80), basisPoints: cleanBasisPoints(sub?.basisPoints, `Sous-rubrique de « ${rubricName} »`) }));
    uniqueNames(subRubrics, `sous-rubriques de « ${rubricName} »`);
    if (subRubrics.reduce((sum, sub) => sum + sub.basisPoints, 0) > 10000) fail(`Les sous-rubriques de « ${rubricName} » dépassent 100 %.`);
    return { id: cleanId(rubric?.id, "rubrique"), name: rubricName, subRubrics };
  });
  uniqueNames(rubrics, "rubriques");
  const ids = [...rubrics.map((r) => r.id), ...rubrics.flatMap((r) => r.subRubrics.map((s) => s.id))];
  if (new Set(ids).size !== ids.length) fail("Identifiant en double dans le modèle.");
  const rubricIds = new Set(rubrics.map((r) => r.id));
  const rawFeeTypes = input?.feeTypes ?? [];
  if (!Array.isArray(rawFeeTypes) || rawFeeTypes.length > TEMPLATE_LIMITS.feeTypes) fail(`Au plus ${TEMPLATE_LIMITS.feeTypes} types de frais.`);
  const feeTypes = rawFeeTypes.map((feeType) => {
    const label = cleanName(feeType?.label, "Type de frais", 60);
    return { id: cleanId(feeType?.id, "type de frais"), label, allocations: cleanAllocations(feeType?.allocations, rubricIds, label) };
  });
  uniqueNames(feeTypes, "types de frais");
  if (new Set(feeTypes.map((f) => f.id)).size !== feeTypes.length) fail("Identifiant en double dans les types de frais.");
  const defaultAllocations = cleanAllocations(input?.defaultAllocations ?? [], rubricIds, "Tout autre frais");
  return { name, rubrics, feeTypes, defaultAllocations };
}

export async function readAllocationTemplate({ db, caller }) {
  const snapshot = await db.doc(`${TEMPLATE_COLLECTION}/${caller.coordinationId}`).get();
  return { template: snapshot.exists ? snapshot.data() : null };
}

/** Publie une nouvelle version. `expectedVersion` évite d'écraser une version publiée entre-temps (autre onglet). */
export async function publishAllocationTemplate({ db, caller, input, now = new Date().toISOString() }) {
  const template = validateAllocationTemplate(input);
  const expectedVersion = input?.expectedVersion;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) fail("Version attendue invalide.");
  const ref = db.doc(`${TEMPLATE_COLLECTION}/${caller.coordinationId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? Number(snapshot.data().version ?? 0) : 0;
    if (current !== expectedVersion) fail("Le modèle a été publié entre-temps : fermez et rouvrez pour voir la dernière version.", 409, "conflict");
    const version = current + 1;
    const published = { coordinationId: caller.coordinationId, ...template, version, publishedAt: now, publishedBy: caller.uid, publishedByName: caller.profile?.name ?? "Coordinateur" };
    transaction.set(ref, published);
    transaction.create(db.doc(`${TEMPLATE_COLLECTION}/${caller.coordinationId}/versions/${version}`), published);
    const auditRef = db.collection("auditLogs").doc();
    transaction.create(auditRef, { id: auditRef.id, eventType: "coordination.allocation_template.published", coordinationId: caller.coordinationId, actorId: caller.uid, actorRole: caller.role,
      actorName: caller.profile?.name ?? "Coordinateur", action: `Modèle de répartition publié (version ${version})`, resourceType: "coordinationAllocationTemplate", resourceId: caller.coordinationId, metadata: { version, name: template.name }, createdAt: now });
    return { template: published };
  });
}
