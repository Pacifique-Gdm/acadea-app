import { createHash } from "node:crypto";
import { requireActiveSchoolYear } from "./schoolYear.js";

const confirmationText = "AJOUTER CETTE SOUS-CLASSE";

function reject(message, statusCode, code) {
  throw Object.assign(new Error(message), { statusCode, code });
}

function normalized(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizedOption(value) {
  const key = normalized(value);
  return ["science", "sciences", "scientifique", "section scientifique"].includes(key) ? "sciences" : key;
}

function schoolOptions(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["options", "values", "items"]) if (Array.isArray(value[key])) return value[key];
  return Object.entries(value).flatMap(([key, enabled]) => enabled === true ? [key] : typeof enabled === "string" ? [enabled] : []);
}

function expectedParentId(schoolId, schoolYearId, name) {
  const slug = normalized(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${schoolId}__${schoolYearId}__${slug}`;
}

export async function createSchoolSubclasses({ db, caller, body }) {
  const schoolId = typeof body.schoolId === "string" ? body.schoolId.trim() : "";
  const schoolYearId = typeof body.schoolYearId === "string" ? body.schoolYearId.trim() : "";
  const parentId = typeof body.parentId === "string" ? body.parentId.trim() : "";
  const parentName = typeof body.parentName === "string" ? body.parentName.trim() : "";
  const classOptionKey = typeof body.classOptionKey === "string" ? body.classOptionKey.trim() : "";
  if (!schoolId || !schoolYearId || !parentId || !parentName) reject("École, année et classe parent requises.", 400, "invalid-argument");
  if (body.confirmation !== confirmationText) reject("Confirmation d'ajout invalide.", 400, "invalid-confirmation");
  if (!["school_admin", "secretary"].includes(caller?.role) || caller.schoolId !== schoolId || !caller.uid) reject("Création de sous-classe non autorisée.", 403, "permission-denied");
  if (!Array.isArray(body.labels) || body.labels.length < 1 || body.labels.length > 20 || body.labels.some((label) => typeof label !== "string" || label.trim().length < 1 || label.length > 100)) {
    reject("Saisissez entre une et vingt sous-classes valides.", 400, "invalid-argument");
  }
  const labels = body.labels.map((label) => label.trim().replace(/\s+/g, " "));
  if (new Set(labels.map(normalized)).size !== labels.length) reject("Les libellés des sous-classes doivent être uniques.", 409, "duplicate-subclass");
  await requireActiveSchoolYear(db, schoolId, schoolYearId);
  const parentRef = db.doc(`classes/${parentId}`);
  const actorRef = db.doc(`users/${caller.uid}`);
  const schoolRef = db.doc(`schools/${schoolId}`);
  const siblingsQuery = db.collection("classes").where("parentClassId", "==", parentId);
  return db.runTransaction(async (transaction) => {
    const [actorSnapshot, schoolSnapshot, parentSnapshot, siblingsSnapshot] = await Promise.all([
      transaction.get(actorRef), transaction.get(schoolRef), transaction.get(parentRef), transaction.get(siblingsQuery),
    ]);
    const actor = actorSnapshot.exists ? actorSnapshot.data() : undefined;
    if (!actor || actor.role !== caller.role || actor.schoolId !== schoolId || actor.status === "inactive" || actor.active === false) reject("Compte utilisateur inactif ou non autorisé.", 403, "permission-denied");
    if (!schoolSnapshot.exists) reject("École introuvable.", 404, "not-found");
    const school = schoolSnapshot.data();
    if (school.status === "inactive" || school.status === "suspended" || school.status === "deleting") reject("École inactive.", 409, "failed-precondition");
    const parent = parentSnapshot.exists ? parentSnapshot.data() : undefined;
    if (parent) {
      if (parent.schoolId !== schoolId || parent.schoolYearId !== schoolYearId || parent.parentClassId || parent.active === false || normalized(parent.name) !== normalized(parentName)) reject("Classe parent hors périmètre.", 403, "permission-denied");
    } else if (expectedParentId(schoolId, schoolYearId, parentName) !== parentId) {
      reject("Classe parent introuvable ou invalide.", 404, "not-found");
    }
    const humanity = /Humanit[ée]s?/i.test(parentName);
    if (humanity && !classOptionKey) reject("L'option est obligatoire pour les Humanités.", 400, "invalid-option");
    if (classOptionKey) {
      const option = classOptionKey.startsWith(`${parentId}::`) ? classOptionKey.slice(parentId.length + 2) : "";
      if (!humanity || !option || !schoolOptions(school.schoolOptions).some((item) => normalizedOption(item) === normalizedOption(option))) reject("Option hors périmètre de l'école.", 400, "invalid-option");
    }
    const siblings = siblingsSnapshot.docs.filter((snapshot) => {
      const item = snapshot.data();
      return item.schoolId === schoolId && item.schoolYearId === schoolYearId && item.parentClassId === parentId && (item.classOptionKey ?? "") === classOptionKey;
    });
    if (labels.some((label) => siblings.some((snapshot) => snapshot.data().active !== false && normalized(snapshot.data().subClassLabel) === normalized(label)))) {
      reject("Cette sous-classe existe déjà.", 409, "duplicate-subclass");
    }
    const now = new Date().toISOString();
    if (!parent) transaction.create(parentRef, { id: parentId, schoolId, schoolYearId, name: parentName, active: true, createdBy: caller.uid, createdAt: now, updatedAt: now });
    const ids = labels.map((label) => {
      const existingInactive = siblings.find((snapshot) => snapshot.data().active === false && normalized(snapshot.data().subClassLabel) === normalized(label));
      if (existingInactive) {
        transaction.update(existingInactive.ref, { active: true, updatedAt: now, updatedBy: caller.uid });
        return existingInactive.id;
      }
      const hash = createHash("sha256").update(`${classOptionKey}\0${normalized(label)}`).digest("hex").slice(0, 24);
      const id = `${parentId}__subclass__${hash}`;
      transaction.create(db.doc(`classes/${id}`), { id, schoolId, schoolYearId, name: `${parentName}${classOptionKey ? ` - ${classOptionKey.slice(parentId.length + 2)}` : ""} - ${label}`, parentClassId: parentId, ...(classOptionKey ? { classOptionKey } : {}), subClassLabel: label, active: true, createdBy: caller.uid, createdAt: now, updatedAt: now });
      return id;
    });
    return { parentId, subclassIds: ids };
  });
}
