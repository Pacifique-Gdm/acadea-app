import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { FeeAllocationConfig } from "../../types/feeAllocation";
import { pendingPublications, type PlanVersion } from "./feeAllocationPublishPlan";

const config = (feeTypeId: string, draftRevision: number, extra: Partial<FeeAllocationConfig> = {}): FeeAllocationConfig => ({ id: `c-${feeTypeId}`, schoolId: "s", schoolYearId: "y",
  feeTypeId, className: "1ère", currency: "USD", draftRevision, draft: { rubrics: [], feeAmountMinor: 10000, updatedAt: "x", updatedBy: "u" }, ...extra });
const version = (feeTypeId: string, v: number, status: PlanVersion["status"], extra: Partial<PlanVersion> = {}): PlanVersion => ({ id: `v-${feeTypeId}-${v}`, feeTypeId, version: v, status, ...extra });

describe("correction 1.20.1 : frais à préparer et publier", () => {
  it("répartition active : le nouveau frais est repéré même s'il n'est pas le premier de la liste", () => {
    // Ancien code : l'écran prenait le premier frais qui avait un brouillon (déjà réparti) et cachait le bouton.
    const configs = [config("ancien", 1, { currentVersionId: "v-ancien-1" }), config("nouveau", 1)];
    const plan = pendingPublications(configs, [version("ancien", 1, "published"), version("nouveau", 1, "prepared")], "ACTIVE");
    expect(plan.items).toEqual([{ feeTypeId: "nouveau", draftRevision: 1, preparedId: "v-nouveau-1", hasSocialPart: false }]);
    expect(plan.locked).toBe(0);
  });
  it("répartition active : un frais déjà réparti avec un nouveau brouillon est bloqué, pas proposé", () => {
    const plan = pendingPublications([config("ancien", 2, { currentVersionId: "v-ancien-1" })], [version("ancien", 1, "published")], "ACTIVE");
    expect(plan.items).toEqual([]); expect(plan.locked).toBe(1);
  });
  it("avant l'activation : toutes les classes d'un frais à la fois, préparées ou non", () => {
    const configs = [config("1ere", 1), config("2eme", 1), config("3eme", 1)];
    const plan = pendingPublications(configs, [version("1ere", 1, "published"), version("2eme", 1, "prepared")], "EN_PREPARATION");
    expect(plan.items.map((item) => [item.feeTypeId, item.preparedId])).toEqual([["2eme", "v-2eme-1"], ["3eme", null]]);
  });
  it("la partie des cas sociaux demande la phrase (brouillon ou version préparée)", () => {
    const withSocial = config("a", 1, { draft: { rubrics: [], socialRubrics: [{ id: "r", name: "R", mode: "percent", basisPoints: 2000 }], feeAmountMinor: 10000, updatedAt: "x", updatedBy: "u" } });
    expect(pendingPublications([withSocial], [], "EN_PREPARATION").items[0].hasSocialPart).toBe(true);
    expect(pendingPublications([config("b", 1)], [version("b", 1, "prepared", { hasSocialPart: true })], "ACTIVE").items[0].hasSocialPart).toBe(true);
  });
  it("le drawer a un bouton direct « Partie 2 — cas sociaux », sans passer par le détail d'une rubrique", () => {
    const drawer = readFileSync(new URL("./FeeAllocationDrawer.tsx", import.meta.url), "utf8");
    expect(drawer).toContain("data-social-part-direct");
    const activation = readFileSync(new URL("./FeeAllocationActivation.tsx", import.meta.url), "utf8");
    expect(activation).toContain("pendingPublications(");
    expect(activation).not.toContain("workspace.configs.find(c => c.draft");
  });
});
