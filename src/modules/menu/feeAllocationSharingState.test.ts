import { describe, expect, it } from "vitest";
import { allocationViewers } from "./feeAllocationSharingState";
import { rubricsSharedWith, type AllocationShares } from "../../services/feeAllocation";

const shares: AllocationShares = {
  schoolId: "s", schoolYearId: "y", revision: "r",
  rubrics: { ecole: { all: true, exceptUserIds: ["mbuyi"] }, ens: { all: false, userIds: ["kabongo", "ilunga"] } },
  staff: [
    { id: "ilunga", name: "Mme Ilunga", role: "study_director" },
    { id: "kabongo", name: "M. Kabongo", role: "discipline_director" },
    { id: "mbuyi", name: "Mme Mbuyi", role: "teacher" },
    { id: "tshibola", name: "M. Tshibola", role: "secretary" },
  ],
};
const names = new Map([["ecole", "Part de l'école"], ["ens", "Part des enseignants"]]);

describe("onglet « Partage répartition »", () => {
  it("ce que voit chaque personne : tout le personnel sauf exception, plus les personnes choisies", () => {
    expect(rubricsSharedWith(shares.rubrics, "kabongo").sort()).toEqual(["ecole", "ens"]);
    expect(rubricsSharedWith(shares.rubrics, "mbuyi")).toEqual([]);
    expect(rubricsSharedWith(shares.rubrics, "tshibola")).toEqual(["ecole"]);
  });
  it("liste « Tout le personnel » puis chaque personne qui voit quelque chose ; personne d'autre", () => {
    const viewers = allocationViewers(shares, names);
    expect(viewers.map((v) => v.label)).toEqual(["Tout le personnel", "Mme Ilunga", "M. Kabongo", "M. Tshibola"]);
    expect(viewers.find((v) => v.id === "kabongo")).toMatchObject({ detail: "Directeur de discipline", rubricIds: ["ecole", "ens"] });
  });
  it("aucun partage : liste vide", () => {
    expect(allocationViewers({ ...shares, rubrics: {} }, names)).toEqual([]);
  });
});
