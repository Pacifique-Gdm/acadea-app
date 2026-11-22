import { describe, expect, it } from "vitest";
import { socialPartPreview, socialPartRubrics } from "./feeAllocationSocialPartPreview";

// Lot 27c-4 : aperçu côte à côte, sur l'exemple réel de C.S LUMBULA (Minerval 120 USD, réduction 50 USD).
const ids = { promoteur: "d".repeat(32), ecole: "e".repeat(32), enseignants: "f".repeat(32) };
const partOne = { feeAmountMinor: 12000, rubrics: [
  { id: ids.promoteur, name: "Part du Promoteur", mode: "percent" as const, basisPoints: 4000 },
  { id: ids.ecole, name: "Part de l'école", mode: "percent" as const, basisPoints: 2000 },
  { id: ids.enseignants, name: "Part des enseignants", mode: "percent" as const, basisPoints: 4000 }] };
const amounts = (rows: ReturnType<typeof socialPartPreview>) => Object.fromEntries(rows.map((row) => [row.name, [row.normalMinor, row.socialMinor]]));

describe("aperçu de la partie 2", () => {
  it("copie de la partie 1 : élève normal 48/24/48, cas social à 70 USD 28/14/28", () => {
    expect(amounts(socialPartPreview(partOne, partOne.rubrics, 7000))).toEqual({
      "Part du Promoteur": [4800, 2800], "Part de l'école": [2400, 1400], "Part des enseignants": [4800, 2800], "Non affecté": [0, 0] });
  });
  it("enseignants en montant fixe : gardé si le net suffit, sinon tout est réduit à proportion", () => {
    const part2 = socialPartRubrics([{ id: ids.promoteur, name: "Part du Promoteur", mode: "percent", value: "40" },
      { id: ids.ecole, name: "Part de l'école", mode: "percent", value: "20" }, { id: ids.enseignants, name: "Part des enseignants", mode: "fixed", value: "30" }]);
    expect(part2.error).toBe("");
    expect(amounts(socialPartPreview(partOne, part2.rubrics, 7000))).toEqual({
      // 28 + 14 + 30 = 72 USD demandés pour 70 USD dus : chaque ligne réduite à proportion (× 70/72).
      "Part du Promoteur": [4800, 2722], "Part de l'école": [2400, 1361], "Part des enseignants": [4800, 2917], "Non affecté": [0, 0] });
    // Net de 90 USD : 36 + 18 + 30 = 84, le reste (6 USD) va dans « Non affecté ».
    expect(amounts(socialPartPreview(partOne, part2.rubrics, 9000))).toMatchObject({ "Part des enseignants": [4800, 3000], "Non affecté": [0, 600] });
  });
  it("saisie invalide ou net hors tarif : message clair", () => {
    expect(socialPartRubrics([{ id: ids.promoteur, name: "P", mode: "percent", value: "abc" }]).error).toMatch("valeur positive");
    expect(() => socialPartPreview(partOne, partOne.rubrics, 13000)).toThrow("entre 0 et le tarif");
  });
});

describe("partie 2 : lignes retirées", () => {
  const lines = [{ id: ids.promoteur, name: "Part du Promoteur", mode: "percent" as const, value: "40", removed: true },
    { id: ids.ecole, name: "Part de l'école", mode: "percent" as const, value: "30" }, { id: ids.enseignants, name: "Part des enseignants", mode: "percent" as const, value: "50" }];
  it("Promoteur retiré : 0 % envoyé, il ne reçoit rien et le reste suit les lignes restantes", () => {
    const part2 = socialPartRubrics(lines);
    expect(part2.error).toBe("");
    expect(part2.rubrics[0]).toMatchObject({ mode: "percent", basisPoints: 0 });
    expect(amounts(socialPartPreview(partOne, part2.rubrics, 7000))).toEqual({
      "Part du Promoteur": [4800, 0], "Part de l'école": [2400, 2100], "Part des enseignants": [4800, 3500], "Non affecté": [0, 1400] });
  });
  it("« Non affecté » retiré : le total doit faire exactement 100 %", () => {
    expect(socialPartRubrics(lines, { unallocatedRemoved: true }).error).toMatch("exactement 100 % (actuellement 80 %)");
    expect(socialPartRubrics(lines.map((l) => l.id === ids.ecole ? { ...l, value: "50" } : l), { unallocatedRemoved: true }).error).toBe("");
    expect(socialPartRubrics(lines.map((l) => l.id === ids.ecole ? { ...l, value: "60" } : l)).error).toMatch("ne doit pas dépasser 100 %");
  });
});
