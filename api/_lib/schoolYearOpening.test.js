// Lot 15 — règle d'ouverture d'une année scolaire (heure de Kinshasa).
import { describe, expect, it } from "vitest";
import { currentSchoolYearStart, schoolYearDatesFromName, schoolYearOpeningDecision } from "./schoolYearOpening.js";

const at = (iso) => ({ now: new Date(iso) });
describe("lot 15 — ouverture d'une année : seulement le nom", () => {
  it("en novembre 2026 : « 2027-2028 » refusée, avec le message exact ; « 2026-2027 » acceptée, dates calculées", () => {
    expect(schoolYearOpeningDecision("2027-2028", at("2026-11-18T10:00:00Z"))).toEqual({ ok: false, code: "year-too-early",
      message: "Impossible d'ouvrir l'année 2027-2028 maintenant : l'année en cours est 2026-2027. L'année 2027-2028 pourra être ouverte à partir du 1er juillet 2027." });
    expect(schoolYearOpeningDecision(" 2026 – 2027 ", at("2026-11-18T10:00:00Z"))).toEqual({ ok: true, name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-31" });
  });
  it("l'année suivante à partir du 1er juillet (heure de Kinshasa), pas avant", () => {
    expect(schoolYearOpeningDecision("2027-2028", at("2027-06-30T22:59:00Z")).ok).toBe(false); // 23 h 59 à Kinshasa, 30 juin
    expect(schoolYearOpeningDecision("2027-2028", at("2027-06-30T23:00:00Z")).ok).toBe(true); // minuit à Kinshasa, 1er juillet
  });
  it("bascule de l'année en cours le 1er août (heure de Kinshasa)", () => {
    expect(currentSchoolYearStart(new Date("2027-07-31T22:59:00Z"))).toBe(2026);
    expect(currentSchoolYearStart(new Date("2027-07-31T23:00:00Z"))).toBe(2027);
    expect(schoolYearOpeningDecision("2026-2027", at("2027-08-02T10:00:00Z"))).toMatchObject({ ok: false, code: "year-in-past" });
  });
  it("nom invalide ou déjà existant refusé", () => {
    expect(schoolYearOpeningDecision("2026-2028", at("2026-11-18T10:00:00Z"))).toMatchObject({ ok: false, code: "invalid-name" });
    expect(schoolYearOpeningDecision("Année 2026", at("2026-11-18T10:00:00Z"))).toMatchObject({ ok: false, code: "invalid-name" });
    expect(schoolYearOpeningDecision("2026-2027", { ...at("2026-11-18T10:00:00Z"), existingNames: ["2026-2027"] })).toMatchObject({ ok: false, code: "year-already-exists" });
    expect(schoolYearDatesFromName("2026-2027")).toEqual({ startsAt: "2026-09-01", endsAt: "2027-07-31" });
  });
});
