import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Payment } from "../types";
import { cachedHistoricalArrears, clearHistoricalArrearsCache, historicalArrearsFingerprint, historicalArrearsKey, peekHistoricalArrears } from "./historicalArrearsCache";

const debt = { schoolYearId: "old", yearName: "2025-2026", studentId: "s-old", feeTypeId: "fee", feeName: "Minerval", expected: 100, paid: 40, remaining: 60, currency: "USD" as const };
const result = { debts: [debt], settled: [] };
const student = { id: "s", matricule: "ACD-26-0001", importedFromStudentId: "s-old", nom: "Kabila", postnom: "", prenom: "Jean" };
const payment = (extra: Partial<Payment>): Payment => ({ id: "p1", schoolId: "a", schoolYearId: "old", studentId: "s-old", currentStudentId: "s", collectionSchoolYearId: "active", feeTypeId: "fee", amount: 10, paidAt: "2026-11-18", cashierName: "Caisse", ...extra });

describe("mémoire des dettes des années antérieures", () => {
  beforeEach(() => clearHistoricalArrearsCache());

  it("calcule une seule fois tant que rien ne change, puis répond tout de suite", async () => {
    const load = vi.fn(async () => result);
    const key = historicalArrearsKey("u1", "active", "s"), print = historicalArrearsFingerprint(student, [], "active");
    expect(peekHistoricalArrears(key, print)).toBeUndefined();
    await expect(Promise.all([cachedHistoricalArrears(key, print, load), cachedHistoricalArrears(key, print, load)])).resolves.toEqual([result, result]);
    await cachedHistoricalArrears(key, print, load);
    expect(load).toHaveBeenCalledTimes(1);
    expect(peekHistoricalArrears(key, print)).toEqual(result);
  });

  it("recalcule quand un paiement d'arriéré est créé, corrigé ou annulé", () => {
    const none = historicalArrearsFingerprint(student, [], "active");
    const created = historicalArrearsFingerprint(student, [payment({})], "active");
    const corrected = historicalArrearsFingerprint(student, [payment({ amount: 8, updatedAt: "2026-11-18T10:00" })], "active");
    expect(new Set([none, created, corrected]).size).toBe(3);
    expect(historicalArrearsFingerprint(student, [], "active")).toBe(none);
  });

  it("ne recalcule pas pour un paiement de l'année en cours ou d'un autre élève", () => {
    const none = historicalArrearsFingerprint(student, [], "active");
    expect(historicalArrearsFingerprint(student, [payment({ schoolYearId: "active", studentId: "s", collectionSchoolYearId: undefined })], "active")).toBe(none);
    expect(historicalArrearsFingerprint(student, [payment({ currentStudentId: "autre", studentId: "autre-old" })], "active")).toBe(none);
  });

  it("recalcule si la fiche change (matricule, filiation, nom)", () => {
    const none = historicalArrearsFingerprint(student, [], "active");
    expect(historicalArrearsFingerprint({ ...student, matricule: "ACD-26-0002" }, [], "active")).not.toBe(none);
    expect(historicalArrearsFingerprint({ ...student, importedFromStudentId: "x" }, [], "active")).not.toBe(none);
    expect(historicalArrearsFingerprint({ ...student, nom: "Autre" }, [], "active")).not.toBe(none);
  });

  it("sépare les utilisateurs, ne garde jamais une erreur et respecte la durée maximale", async () => {
    const key = historicalArrearsKey("u1", "active", "s"), print = "x";
    expect(historicalArrearsKey("u2", "active", "s")).not.toBe(key);
    await expect(cachedHistoricalArrears(key, print, async () => { throw new Error("réseau"); })).rejects.toThrow("réseau");
    await Promise.resolve();
    const load = vi.fn(async () => result);
    await cachedHistoricalArrears(key, print, load, { now: 0, maxAgeMs: 1000 });
    await cachedHistoricalArrears(key, print, load, { now: 500, maxAgeMs: 1000 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(peekHistoricalArrears(key, print, 1000, 2000)).toBeUndefined();
    await cachedHistoricalArrears(key, print, load, { now: 2000, maxAgeMs: 1000 });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("écran Contrôle : la section des dettes ne bloque rien", () => {
  const source = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");
  const section = source.slice(source.indexOf("Dettes des années antérieures</h2>"), source.indexOf("Règlements des arriérés encaissés cette année"));
  it("affiche un indicateur de chargement et une erreur propres à cette section", () => {
    expect(section).toContain('role="status"');
    expect(section).toContain("Chargement des dettes des années antérieures…");
    expect(section).toContain("historyArrearsError");
    expect(section).toContain("!historyArrearsLoading && !historyArrearsError && historyArrears.length === 0");
  });
  it("passe par la mémoire, avec l'empreinte des paiements d'arriérés", () => {
    expect(source).toContain("cachedHistoricalArrears(key, historyArrearsFingerprint");
    expect(source).toContain("cachedHistoricalArrears(key, paymentArrearsFingerprint");
    expect(source).toContain("[selectedHistoryStudentId, year.id, year.status, user.id, historyArrearsFingerprint]");
  });
});
