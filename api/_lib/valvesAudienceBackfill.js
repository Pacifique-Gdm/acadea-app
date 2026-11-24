// Reprise des publications Valves existantes : ajout du public lisible par les règles
// (audienceAll, audienceParentIds), calculé exactement comme l'écran le fait aujourd'hui.
// LECTURE SEULE par défaut : le plan dit ce qui sera ajouté à chaque Valve et montre les cas
// douteux. L'écriture (applyValvesAudiencePlan) ne touche que les Valves du plan, avec une
// précondition « document inchangé depuis la lecture ».
import { computeValveAudience, normalizeValveAudienceVisibility, valveAudienceDoubt, MAX_VALVE_AUDIENCE_PARENTS } from "../../src/utils/valveAudience.js";

const docs = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data(), __updateTime: item.updateTime }));

async function loadSchoolIds(db, schoolId) {
  if (schoolId && schoolId !== "toutes") return [schoolId];
  const snapshot = await db.collection("valves").select("schoolId").get();
  return [...new Set(snapshot.docs.map((item) => item.get("schoolId")).filter((value) => typeof value === "string" && value))].sort();
}

/** Plan de reprise (aucune écriture). */
export async function planValvesAudienceBackfill({ db, schoolId = "toutes" }) {
  const schools = await loadSchoolIds(db, schoolId);
  const plan = { schools: [], totals: { valves: 0, dejaFaites: 0, aCompleter: 0, tous: 0, cibles: 0, sansDestinataire: 0, douteuses: 0 }, douteuses: [], ecritures: [] };
  for (const id of schools) {
    const valves = docs(await db.collection("valves").where("schoolId", "==", id).get());
    if (!valves.length) continue;
    const parents = docs(await db.collection("parents").where("schoolId", "==", id).get());
    const studentsByYear = new Map();
    const schoolRow = { schoolId: id, valves: valves.length, dejaFaites: 0, aCompleter: 0, tous: 0, cibles: 0, sansDestinataire: 0, douteuses: 0 };
    for (const valve of valves) {
      plan.totals.valves += 1;
      if (typeof valve.audienceAll === "boolean" && Array.isArray(valve.audienceParentIds)) { schoolRow.dejaFaites += 1; plan.totals.dejaFaites += 1; continue; }
      if (!studentsByYear.has(valve.schoolYearId)) studentsByYear.set(valve.schoolYearId, docs(await db.collection("students").where("schoolId", "==", id).where("schoolYearId", "==", valve.schoolYearId ?? "").get()));
      const doubt = valveAudienceDoubt(valve);
      // Une visibilité absente ou inconnue n'est montrée à aucun parent aujourd'hui : elle reste
      // fermée (liste vide), jamais mise en « tous ». Les anciennes valeurs « parents », « all »,
      // « staff » sont déjà montrées à tous aujourd'hui : elles passent en « tous ».
      const audience = doubt && normalizeValveAudienceVisibility(valve.visibility) !== "all_parents"
        ? { audienceAll: false, audienceParentIds: [] }
        : computeValveAudience(valve, parents, studentsByYear.get(valve.schoolYearId));
      if (audience.audienceParentIds.length > MAX_VALVE_AUDIENCE_PARENTS) throw new Error(`Valve ${valve.id} : trop de destinataires (${audience.audienceParentIds.length}).`);
      if (doubt) { schoolRow.douteuses += 1; plan.totals.douteuses += 1; plan.douteuses.push({ schoolId: id, valveId: valve.id, titre: String(valve.title ?? "").slice(0, 80), visibilite: valve.visibility ?? null, motif: doubt, decision: audience.audienceAll ? "tous" : "fermée (aucun parent)" }); }
      if (audience.audienceAll) { schoolRow.tous += 1; plan.totals.tous += 1; }
      else if (audience.audienceParentIds.length) { schoolRow.cibles += 1; plan.totals.cibles += 1; }
      else { schoolRow.sansDestinataire += 1; plan.totals.sansDestinataire += 1; }
      schoolRow.aCompleter += 1; plan.totals.aCompleter += 1;
      const { __updateTime, ...original } = valve;
      plan.ecritures.push({ valveId: valve.id, schoolId: id, updateTime: __updateTime, original, ajout: audience });
    }
    plan.schools.push(schoolRow);
  }
  return plan;
}

/** Écrit le plan. Chaque Valve n'est modifiée que si elle n'a pas changé depuis la lecture. */
export async function applyValvesAudiencePlan({ db, plan }) {
  let ecrites = 0; const ignorees = [];
  for (const item of plan.ecritures) {
    try {
      await db.doc(`valves/${item.valveId}`).update({ audienceAll: item.ajout.audienceAll, audienceParentIds: item.ajout.audienceParentIds }, item.updateTime ? { lastUpdateTime: item.updateTime } : undefined);
      ecrites += 1;
    } catch (error) {
      ignorees.push({ valveId: item.valveId, motif: String(error?.message ?? error).slice(0, 160) });
    }
  }
  return { ecrites, ignorees };
}

/** Retour arrière : retire les deux champs ajoutés aux Valves de la sauvegarde qui ne les avaient pas. */
export async function restoreValvesAudience({ db, backup, deleteField }) {
  let restaurees = 0;
  for (const item of backup.valves ?? []) {
    const ref = db.doc(`valves/${item.id}`);
    const current = await ref.get();
    if (!current.exists) continue;
    const patch = {};
    if (!Object.hasOwn(item, "audienceAll")) patch.audienceAll = deleteField(); else patch.audienceAll = item.audienceAll;
    if (!Object.hasOwn(item, "audienceParentIds")) patch.audienceParentIds = deleteField(); else patch.audienceParentIds = item.audienceParentIds;
    await ref.update(patch);
    restaurees += 1;
  }
  return { restaurees };
}
