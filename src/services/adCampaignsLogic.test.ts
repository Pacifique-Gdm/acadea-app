import { describe, expect, it } from "vitest";
import {
  AD_DEFAULT_ROLES,
  adAudienceRoleFor,
  adDay,
  adStatsIncrements,
  adStatsShard,
  buildActiveSettings,
  buildAdRotation,
  campaignPhase,
  campaignsForViewer,
  clampRotationSeconds,
  parseActiveSettings,
  readyAdReports,
  recordAdEvent,
  summarizeAdStats,
  validateAdCampaign,
  type ActiveAdCampaign,
  type AdCampaign,
  type AdCampaignDraft,
} from "./adCampaignsLogic";

const base: ActiveAdCampaign = {
  id: "adA",
  brand: "Marque A",
  linkUrl: "https://exemple.test/a",
  startDate: "2026-11-10",
  endDate: "2026-11-30",
  targetMode: "all",
  schoolIds: [],
  coordinationId: "",
  roles: [...AD_DEFAULT_ROLES],
  weight: 1,
  desktopVersion: "d1",
  phoneVersion: "p1",
};

const settings = (campaigns: ActiveAdCampaign[]) => ({ rotationSeconds: 30, campaigns, updatedAt: "" });
const parent = { role: "parent" as const, schoolId: "s1", coordinationId: "c1" };

describe("dates à l'heure de Kinshasa", () => {
  it("passe au jour suivant à minuit à Kinshasa (UTC+1), pas à minuit UTC", () => {
    expect(adDay(new Date("2026-11-30T22:59:00Z"))).toBe("2026-11-30");
    expect(adDay(new Date("2026-11-30T23:00:00Z"))).toBe("2026-12-01");
  });

  it("la campagne s'affiche du début à la fin inclus, puis l'en-tête revient seul", () => {
    expect(campaignsForViewer(settings([base]), parent, "2026-11-09")).toHaveLength(0);
    expect(campaignsForViewer(settings([base]), parent, "2026-11-10")).toHaveLength(1);
    expect(campaignsForViewer(settings([base]), parent, "2026-11-30")).toHaveLength(1);
    expect(campaignsForViewer(settings([base]), parent, "2026-12-01")).toHaveLength(0);
  });

  it("donne l'état de chaque campagne", () => {
    const campaign = { status: "scheduled" as const, startDate: "2026-11-10", endDate: "2026-11-30" };
    expect(campaignPhase(campaign, "2026-11-01")).toBe("scheduled");
    expect(campaignPhase(campaign, "2026-11-15")).toBe("running");
    expect(campaignPhase(campaign, "2026-12-01")).toBe("ended");
    expect(campaignPhase({ ...campaign, status: "stopped" }, "2026-11-15")).toBe("stopped");
    expect(campaignPhase({ ...campaign, status: "draft" }, "2026-11-15")).toBe("draft");
  });
});

describe("ciblage", () => {
  it("vise certaines écoles, une Coordination ou toutes", () => {
    const schools = { ...base, id: "adS", targetMode: "schools" as const, schoolIds: ["s2"] };
    const coordination = { ...base, id: "adC", targetMode: "coordination" as const, coordinationId: "c1" };
    expect(campaignsForViewer(settings([schools, coordination]), parent, "2026-11-15").map((item) => item.id)).toEqual(["adC"]);
    expect(campaignsForViewer(settings([schools]), { ...parent, schoolId: "s2" }, "2026-11-15").map((item) => item.id)).toEqual(["adS"]);
  });

  it("respecte les rôles cochés", () => {
    const onlyParents = { ...base, roles: ["parent" as const] };
    expect(campaignsForViewer(settings([onlyParents]), { ...parent, role: "cashier" }, "2026-11-15")).toHaveLength(0);
  });

  it("Coordination : seulement si le rôle « Coordination » est coché (décoché par défaut)", () => {
    const coordinator = { role: "coordination" as const, schoolId: "", coordinationId: "c1" };
    expect(AD_DEFAULT_ROLES).not.toContain("coordination");
    expect(campaignsForViewer(settings([base]), coordinator, "2026-11-15")).toHaveLength(0);
    const withCoordination = { ...base, roles: [...AD_DEFAULT_ROLES, "coordination" as const] };
    expect(campaignsForViewer(settings([withCoordination]), coordinator, "2026-11-15")).toHaveLength(1);
    expect(campaignsForViewer(settings([{ ...withCoordination, targetMode: "coordination", coordinationId: "c2" }]), coordinator, "2026-11-15")).toHaveLength(0);
  });

  it("le Super administrateur ne voit jamais de publicité", () => {
    expect(adAudienceRoleFor("super_admin")).toBeNull();
    expect(adAudienceRoleFor("admin")).toBe("school_admin");
    expect(adAudienceRoleFor("sub_coordination_admin")).toBe("coordination");
  });
});

describe("rotation pondérée", () => {
  it("une campagne à 2 passe deux fois plus souvent, sans deux passages de suite", () => {
    const order = buildAdRotation([{ id: "A", weight: 2 }, { id: "B", weight: 1 }]);
    expect(order).toHaveLength(3);
    expect(order.filter((id) => id === "A")).toHaveLength(2);
    expect(order.filter((id) => id === "B")).toHaveLength(1);
    const doubled = [...order, ...order];
    expect(doubled.some((id, index) => id === "B" && doubled[index + 1] === "B")).toBe(false);
  });

  it("parts égales : chacune son tour", () => {
    expect(buildAdRotation([{ id: "A", weight: 1 }, { id: "B", weight: 1 }])).toEqual(["A", "B"]);
  });

  it("durée de rotation : 30 secondes par défaut, 10 secondes au minimum", () => {
    expect(parseActiveSettings({ campaigns: [] })?.rotationSeconds).toBe(30);
    expect(clampRotationSeconds(3)).toBe(10);
  });
});

describe("document lu par les appareils", () => {
  const campaign = (patch: Partial<AdCampaign>): AdCampaign => ({ ...base, status: "scheduled", createdAt: "", updatedAt: "", updatedBy: "", ...patch });

  it("ne garde que les campagnes programmées non terminées, sans données internes", () => {
    const result = buildActiveSettings([
      campaign({ id: "run" }),
      campaign({ id: "draft", status: "draft" }),
      campaign({ id: "stop", status: "stopped" }),
      campaign({ id: "old", endDate: "2026-11-01" }),
    ], 45, "2026-11-15", "t");
    expect(result.campaigns.map((item) => item.id)).toEqual(["run"]);
    expect(result.rotationSeconds).toBe(45);
    expect(Object.keys(result.campaigns[0])).not.toContain("updatedBy");
  });

  it("refuse un lien qui n'est pas en https", () => {
    expect(parseActiveSettings({ campaigns: [{ ...base, linkUrl: "javascript:alert(1)" }] })?.campaigns).toHaveLength(0);
  });
});

describe("formulaire", () => {
  const draft: AdCampaignDraft = { ...base, status: "scheduled", desktopImage: "data:image/webp;base64,AA", phoneImage: "data:image/webp;base64,AA" };
  it("accepte une campagne complète", () => {
    expect(validateAdCampaign(draft, { publish: true })).toEqual([]);
  });
  it("refuse des dates inversées, une image manquante ou aucun rôle", () => {
    expect(validateAdCampaign({ ...draft, startDate: "2026-12-01", endDate: "2026-11-01" }, { publish: true }).length).toBeGreaterThan(0);
    expect(validateAdCampaign({ ...draft, phoneImage: "" }, { publish: true })).toContain("Ajoutez l'image téléphone.");
    expect(validateAdCampaign({ ...draft, roles: [] }, { publish: true })).toContain("Cochez au moins un rôle.");
  });
  it("un brouillon peut rester incomplet", () => {
    expect(validateAdCampaign({ ...draft, linkUrl: "", desktopImage: "", phoneImage: "", startDate: "" }, { publish: false })).toEqual([]);
  });
});

describe("statistiques groupées, sans donnée personnelle", () => {
  const event = { campaignId: "adA", day: "2026-11-15", device: "phone" as const, role: "parent" as const, schoolId: "s1", shardKey: "s1" };

  it("compte sur l'appareil et n'envoie que les jours terminés, un paquet par campagne", () => {
    let pending = {};
    for (let index = 0; index < 5; index += 1) pending = recordAdEvent(pending, event, "view");
    pending = recordAdEvent(pending, event, "click");
    pending = recordAdEvent(pending, { ...event, campaignId: "adB" }, "view");
    expect(readyAdReports(pending, "2026-11-15").ready).toHaveLength(0);
    const { ready } = readyAdReports(pending, "2026-11-16");
    expect(ready).toHaveLength(2);
    expect(ready.find(([, report]) => report.campaignId === "adA")?.[1]).toMatchObject({ views: 5, clicks: 1 });
  });

  it("n'écrit que des totaux : appareil, rôle, école — jamais de compte", () => {
    const fields = adStatsIncrements({ ...event, views: 5, clicks: 1 });
    expect(fields).toEqual({ v: 5, c: 1, vp: 5, cp: 1, r_parent_v: 5, r_parent_c: 1, s_s1_v: 5, s_s1_c: 1 });
  });

  it("une même école tombe toujours dans le même paquet (20 paquets)", () => {
    expect(adStatsShard("s1")).toBe(adStatsShard("s1"));
    expect(adStatsShard("ecole-tres-longue")).toBeLessThan(20);
  });

  it("additionne les paquets pour le tiroir des statistiques", () => {
    const summary = summarizeAdStats([
      { date: "2026-11-15", v: 5, c: 1, vp: 5, cp: 1, r_parent_v: 5, r_parent_c: 1, s_s1_v: 5, s_s1_c: 1 },
      { date: "2026-11-15", v: 3, c: 0, vd: 3, cd: 0, r_cashier_v: 3, r_cashier_c: 0, s_s2_v: 3, s_s2_c: 0 },
    ]);
    expect(summary).toMatchObject({ views: 8, clicks: 1, byDevice: { desktop: { views: 3 }, phone: { views: 5 } } });
    expect(summary.byDay).toEqual([{ day: "2026-11-15", views: 8, clicks: 1 }]);
    expect(summary.bySchool.map((entry) => entry.schoolId)).toEqual(["s1", "s2"]);
    expect(summary.byRole.map((entry) => entry.role)).toEqual(["parent", "cashier"]);
  });
});
