// Lot 27c-3b — prévu des lignes d'arriérés.
import { describe, expect, it } from "vitest";
import { calculateArrearsForecast, linkHistoricalRecords } from "./feeAllocationArrearsForecast.js";
import { manageFeeAllocationPhase2 } from "./feeAllocationPhase2.js";
import { fixture } from "./feeAllocationPhase2.test.js";

const old = { id: "old", schoolId: "s", name: "2025-2026", status: "archived", currency: "USD" };
const record = (id, extra = {}) => ({ id, schoolId: "s", schoolYearId: "old", className: "1ère", matricule: `M-${id}`, nom: "NOM", prenom: id, ...extra });
const fee = { id: "old-fee", schoolId: "s", schoolYearId: "old", name: "Minerval", amount: 100, className: "1ère" };

describe("lot 27c-3b — élèves rattachés à leurs fiches des années passées", () => {
  it("par la filiation ou par le même matricule avec la même identité ; jamais un ancien élève parti", () => {
    const active = [{ id: "a", importedFromStudentId: "r1", matricule: "X" }, { id: "b", matricule: "M-r2", nom: "NOM", prenom: "r2" }];
    const linked = linkHistoricalRecords(active, [record("r1"), record("r2"), record("parti")]);
    expect(linked.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });
  it("deux fiches la même année pour un élève : doute, aucune n'est comptée", () => {
    const linked = linkHistoricalRecords([{ id: "a", importedFromStudentId: "r1", matricule: "M-r9", nom: "NOM", prenom: "r9" }], [record("r1"), record("r9")]);
    expect(linked).toEqual([]);
  });
});

describe("lot 27c-3b — prévu des lignes d'arriérés", () => {
  it("reste dû au début de l'année active, sans répartition d'origine : tout en « Non affecté (arriéré 2025-2026) »", () => {
    const payments = [{ studentId: "r1", feeTypeId: "old-fee", amount: 30 }, { studentId: "r1", feeTypeId: "old-fee", amount: 20, collectionSchoolYearId: "year" }];
    const rows = calculateArrearsForecast({ activeYearId: "year", linkedRecords: [record("r1")], years: [{ year: old, fees: [fee], payments, configs: [], versions: [] }] });
    // 100 − 30 payés avant ; les 20 encaissés cette année restent dans le prévu (ils sont aussi dans l'encaissé).
    expect(rows).toEqual([expect.objectContaining({ table: 1, rubricId: "ARR__old__UNALLOCATED", rubricName: "Non affecté (arriéré 2025-2026)", arrearsYearName: "2025-2026", amountMinor: 7000 })]);
  });
  it("avec la répartition de l'année d'origine : parts de cette année-là ; cas social au tableau 2", () => {
    const rubric = "a".repeat(32);
    const version = { id: "v", status: "published", feeAmountMinor: 10000, rubrics: [{ id: rubric, name: "Promoteur", mode: "percent", basisPoints: 4000 }] };
    const social = record("r2", { financialSupport: { d: { id: "d", schoolYearId: "old", lines: { "old-fee": { reductionMinor: 5000 } } } } });
    const rows = calculateArrearsForecast({ activeYearId: "year", linkedRecords: [record("r1"), social],
      years: [{ year: old, fees: [fee], payments: [], configs: [{ feeTypeId: "old-fee", currentVersionId: "v" }], versions: [version] }] });
    const amount = (table, rubricId) => rows.find((r) => r.table === table && r.rubricId === rubricId)?.amountMinor;
    expect(amount(1, `ARR__old__${rubric}`)).toBe(4000);
    expect(amount(1, "ARR__old__UNALLOCATED")).toBe(6000);
    expect(rows.find((r) => r.rubricId === `ARR__old__${rubric}`).rubricName).toBe("Promoteur (arriéré 2025-2026)");
    expect((amount(2, `ARR__old__${rubric}`) ?? 0) + (amount(2, "ARR__old__UNALLOCATED") ?? 0)).toBe(5000);
  });
  it("rien de dû : aucune ligne", () => {
    expect(calculateArrearsForecast({ activeYearId: "year", linkedRecords: [record("r1")], years: [{ year: old, fees: [fee], payments: [{ studentId: "r1", feeTypeId: "old-fee", amount: 100 }], configs: [], versions: [] }] })).toEqual([]);
  });
});

describe("lot 27c-3b — dans le prévu du drawer, sans identité d'élève, gardé côté serveur", () => {
  it("le prévu contient la ligne d'arriéré ; la deuxième ouverture ne relit pas les années passées", async () => {
    const db = fixture();
    db.records.get("feeTypes/f1").classOptionKey = null;
    db.records.set("schoolYears/old", { schoolId: "s", name: "2025-2026", status: "archived", currency: "USD" });
    db.records.set("students/cur", { schoolId: "s", schoolYearId: "y", className: "1ère", status: "ACTIVE", importedFromStudentId: "hist", matricule: "M1", nom: "SECRET" });
    db.records.set("students/hist", { schoolId: "s", schoolYearId: "old", className: "1ère", status: "ARCHIVED", matricule: "M1", nom: "SECRET" });
    db.records.set("feeTypes/old-fee", { schoolId: "s", schoolYearId: "old", name: "Minerval", amount: 50, className: "1ère" });
    const first = await manageFeeAllocationPhase2({ db, caller: { uid: "a", role: "school_admin", schoolId: "s" }, body: { action: "get-workspace", schoolId: "s" } });
    expect(first.forecast.rows.find((r) => r.rubricId === "ARR__old__UNALLOCATED")).toMatchObject({ amountMinor: 5000, arrearsYearName: "2025-2026" });
    expect(JSON.stringify(first.forecast)).not.toContain("SECRET");
    db.records.delete("feeTypes/old-fee");
    const second = await manageFeeAllocationPhase2({ db, caller: { uid: "a", role: "school_admin", schoolId: "s" }, body: { action: "get-workspace", schoolId: "s" } });
    expect(second.forecast.rows.find((r) => r.rubricId === "ARR__old__UNALLOCATED")?.amountMinor).toBe(5000);
  });
});
