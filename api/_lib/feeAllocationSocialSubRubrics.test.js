// F2 (décisions de l'utilisateur du 27/11/2026) : sous-rubriques pour toute rubrique, refus sans répartition activée,
// sous-rubriques des cas sociaux publiées avec la partie 2 (une seule répartition par rubrique pour tous les frais).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { manageSocialPart } from "./feeAllocationSocialPart.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { SUB_RUBRICS_PHRASE, effectiveSocialSubRubrics, keptSocialSubOverrides, prepareSubRubricReceipt, validateSocialSubOverrides } from "./feeAllocationSubRubrics.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "b".repeat(32), ouvrier = "1".repeat(16), enseignant = "2".repeat(16);
const subs = [{ id: ouvrier, name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: [] }, { id: enseignant, name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }];
let sequence = 0;
afterEach(() => vi.unstubAllEnvs());

function catalogRubric(db, extra = {}) {
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Fonctionnement", hidden: false, ...extra });
  return db;
}
async function activeSchool() {
  const db = completeAllocationFixture();
  const lifecycle = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `f2-active-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId: "a".repeat(32), amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  return catalogRubric(db);
}
const saveSubs = (db, subRubrics) => manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, subRubrics, confirmation: SUB_RUBRICS_PHRASE, requestId: `f2-sub-${++sequence}-request` } });
const publish = (db, socialSubRubrics, extra = {}) => manageSocialPart({ db, caller: admin, now: at, body: { action: "publish-social-parts", requestId: `f2-social-${++sequence}-request`, confirmation: "PUBLIER LA PARTIE DEUX", items: [], socialSubRubrics, ...extra } });

describe("F2 — calcul des sous-rubriques des cas sociaux", () => {
  it("reprend la partie 1, sans les lignes retirées et avec les valeurs modifiées", () => {
    expect(effectiveSocialSubRubrics(subs, undefined)).toEqual(subs);
    expect(effectiveSocialSubRubrics(subs, { [ouvrier]: { removed: true }, [enseignant]: { mode: "fixed", fixedMinor: 300 } }))
      .toEqual([{ id: enseignant, name: "Enseignant", mode: "fixed", fixedMinor: 300, functions: [] }]);
  });
  it("refuse une sous-rubrique inconnue, une valeur invalide et plus de 100 %", () => {
    expect(validateSocialSubOverrides({ [enseignant]: { mode: "percent", basisPoints: 2500 } }, subs)).toEqual({ [enseignant]: { mode: "percent", basisPoints: 2500 } });
    expect(() => validateSocialSubOverrides({ ["3".repeat(16)]: { removed: true } }, subs)).toThrow("Sous-rubrique inconnue");
    expect(() => validateSocialSubOverrides({ [enseignant]: { mode: "percent", basisPoints: 0 } }, subs)).toThrow("invalide");
    expect(() => validateSocialSubOverrides({ [ouvrier]: { mode: "percent", basisPoints: 6000 } }, subs)).toThrow("dépassent 100 %");
  });
  it("après un changement de la partie 1 : les écarts d'une sous-rubrique retirée sont oubliés ; refus au-delà de 100 %", () => {
    expect(keptSocialSubOverrides(undefined, subs)).toBeNull();
    expect(keptSocialSubOverrides({ [ouvrier]: { removed: true }, ["3".repeat(16)]: { removed: true } }, subs)).toEqual({ [ouvrier]: { removed: true } });
    expect(() => keptSocialSubOverrides({ [ouvrier]: { mode: "percent", basisPoints: 6000 } }, subs)).toThrow("partie 2");
  });
  it("un paiement de cas social suivant une partie 2 est partagé selon les sous-rubriques des cas sociaux ; un élève normal selon la partie 1", async () => {
    const rubric = { schoolId: "school", schoolYearId: "year", subRubrics: subs, socialSubRubrics: { [ouvrier]: { removed: true }, [enseignant]: { mode: "percent", basisPoints: 2000 } } };
    const db = { doc: (path) => ({ path }) }, transaction = { get: async () => ({ data: () => structuredClone(rubric) }) };
    const args = { db, transaction, schoolId: "school", schoolYearId: "year", lines: [{ rubricId, amountMinor: 1000 }], priorLines: [{ rubricId, amountMinor: 0 }], nextLines: [{ rubricId, amountMinor: 1000 }], fullLines: [{ rubricId, amountMinor: 4000 }], total: null };
    expect((await prepareSubRubricReceipt(args)).byRubric.get(rubricId)).toEqual([{ subRubricId: ouvrier, amountMinor: 125 }, { subRubricId: enseignant, amountMinor: 500 }]);
    expect((await prepareSubRubricReceipt({ ...args, social: true })).byRubric.get(rubricId)).toEqual([{ subRubricId: enseignant, amountMinor: 200 }]);
    const receipts = readFileSync(new URL("./feeAllocationReceipts.js", import.meta.url), "utf8");
    expect(receipts).toContain("lines, priorLines, nextLines, total, social: !!socialSegments });");
  });
});

describe("F2 — rien ne marche sans répartition activée", () => {
  it("les sous-rubriques sont refusées tant que la répartition n'est pas activée", async () => {
    const db = catalogRubric(completeAllocationFixture());
    await expect(saveSubs(db, subs)).rejects.toThrow("quand la répartition sera activée");
    expect(db.records.get(`feeAllocationRubrics/${rubricId}`).subRubrics).toBeUndefined();
  });
  it("les sous-rubriques des cas sociaux aussi", async () => {
    const db = catalogRubric(completeAllocationFixture(), { subRubrics: subs });
    await expect(publish(db, { [rubricId]: { [ouvrier]: { removed: true } } })).rejects.toThrow("quand la répartition sera activée");
  });
});

describe("F2 — publication avec la partie 2", () => {
  it("une seule phrase « PUBLIER LA PARTIE DEUX » ; les écarts sont gardés sur la rubrique, pour tous les frais", async () => {
    const db = await activeSchool();
    await saveSubs(db, subs.map(({ id, ...sub }) => sub));
    const saved = db.records.get(`feeAllocationRubrics/${rubricId}`).subRubrics;
    const overrides = { [saved[0].id]: { removed: true }, [saved[1].id]: { mode: "percent", basisPoints: 2000 } };
    await expect(publish(db, { [rubricId]: overrides }, { confirmation: "oui" })).rejects.toThrow("PUBLIER LA PARTIE DEUX");
    const result = await publish(db, { [rubricId]: overrides });
    expect(result.socials).toEqual([]);
    expect(db.records.get(`feeAllocationRubrics/${rubricId}`).socialSubRubrics).toEqual(overrides);
    await expect(publish(db, { [rubricId]: { [saved[1].id]: { mode: "percent", basisPoints: 20000 } } })).rejects.toThrow("invalide");
    await expect(publish(db, {})).rejects.toThrow("Demande invalide");
  });
  it("un changement de la partie 1 garde les écarts des cas sociaux encore valables", async () => {
    const db = await activeSchool();
    await saveSubs(db, subs.map(({ id, ...sub }) => sub));
    const saved = db.records.get(`feeAllocationRubrics/${rubricId}`).subRubrics;
    await publish(db, { [rubricId]: { [saved[0].id]: { removed: true } } });
    await saveSubs(db, [saved[1]]);
    expect(db.records.get(`feeAllocationRubrics/${rubricId}`).socialSubRubrics).toEqual({});
  });
});
