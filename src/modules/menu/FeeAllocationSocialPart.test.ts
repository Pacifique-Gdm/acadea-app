import { describe, expect, it } from "vitest";
import { applySocialLinesToAll, sameSocialLines, socialPartLines, socialPartPreview, socialPartRubrics, socialPartTotalText } from "./feeAllocationSocialPartPreview";

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
  it("total inférieur à 100 % accepté (le reste va dans « Non affecté »), supérieur refusé", () => {
    expect(socialPartRubrics(lines).error).toBe("");
    expect(socialPartTotalText(8000, false)).toBe("Total des rubriques : 80 %. Le reste (20 %) va dans « Non affecté ».");
    expect(socialPartRubrics(lines.map((l) => l.id === ids.ecole ? { ...l, value: "60" } : l)).error).toMatch("ne doit pas dépasser 100 %");
  });
  it("exemple de l'utilisateur : il paie 60 $, école 20 % = 12 $, enseignants 40 % = 24 $, 24 $ en « Non affecté »", () => {
    const part2 = socialPartRubrics([{ ...lines[0] }, { ...lines[1], value: "20" }, { ...lines[2], value: "40" }]);
    expect(amounts(socialPartPreview(partOne, part2.rubrics, 6000))).toMatchObject({ "Part de l'école": [2400, 1200], "Part des enseignants": [4800, 2400], "Non affecté": [0, 2400] });
  });
});

describe("version 1.19.0 : un seul formulaire pour tous les frais", () => {
  const other = [{ id: ids.ecole, name: "Part de l'école", mode: "percent" as const, value: "50" }, { id: "g".repeat(32), name: "Cantine", mode: "percent" as const, value: "10" }];
  it("« Appliquer à tous les frais » recopie rubrique par rubrique et signale les rubriques absentes", () => {
    const source = socialPartLines(partOne.rubrics).map((l) => l.id === ids.promoteur ? { ...l, removed: true } : l.id === ids.ecole ? { ...l, value: "25" } : l);
    const [result] = applySocialLinesToAll(source, [{ feeTypeId: "autre", lines: other }]);
    expect(result.lines).toEqual([{ id: ids.ecole, name: "Part de l'école", mode: "percent", value: "25" }, other[1]]);
    // Le Promoteur est retiré : rien ne lui revient, il n'est donc pas signalé ; les enseignants manquent → « Non affecté ».
    expect(result.missing).toEqual(["Part des enseignants"]);
  });
  it("« modifié » : seulement si les réglages diffèrent de la partie 2 publiée", () => {
    const base = socialPartLines(partOne.rubrics);
    expect(sameSocialLines(base, socialPartLines(partOne.rubrics))).toBe(true);
    expect(sameSocialLines(base, base.map((l, i) => i === 0 ? { ...l, removed: true } : l))).toBe(false);
    expect(sameSocialLines(base, base.map((l, i) => i === 0 ? { ...l, value: "40,0" } : l))).toBe(true);
    expect(sameSocialLines(base, base.map((l, i) => i === 0 ? { ...l, value: "41" } : l))).toBe(false);
  });
});
