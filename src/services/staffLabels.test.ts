import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "jeton" }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

import { alreadyModifiedMessage, cachedStaffLabel, clearStaffLabelCache, loadStaffLabels } from "./staffLabels";
import { ModifiedBy } from "../components/ui/ModifiedBy";
import { AssignmentAlreadyModified, assertAssignmentUnchanged } from "../modules/studies/studyService";

const answer = (labels: Record<string, unknown>, ok = true) => vi.fn(async () => ({ ok, json: async () => ok ? { labels } : { error: "Consultation non autorisée." } }) as unknown as Response);

describe("lot R1 : auteur des réglages", () => {
  beforeEach(() => clearStaffLabelCache());

  it("demande chaque compte une seule fois au serveur", async () => {
    const fetcher = answer({ p: { name: "Jean Kasa", functionLabel: "Préfet d'études" } });
    await expect(loadStaffLabels("s", ["p", "inconnu", "p"], fetcher)).resolves.toEqual({ p: { name: "Jean Kasa", functionLabel: "Préfet d'études" } });
    await loadStaffLabels("s", ["p", "inconnu"], fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ action: "staff-labels", schoolId: "s", userIds: ["p", "inconnu"] });
    expect(cachedStaffLabel("s", "p")).toEqual({ name: "Jean Kasa", functionLabel: "Préfet d'études" });
  });

  it("écrit « Déjà modifié par [nom, fonction], rechargez. », ou reste anonyme", async () => {
    await loadStaffLabels("s", ["p"], answer({ p: { name: "Jean Kasa", functionLabel: "Préfet d'études" } }));
    await expect(alreadyModifiedMessage("s", "p")).resolves.toBe("Déjà modifié par Jean Kasa, Préfet d'études, rechargez.");
    await expect(alreadyModifiedMessage("s", undefined)).resolves.toBe("Déjà modifié par une autre personne, rechargez.");
  });

  it("affiche « Publié par Nom, Fonction le … »", () => {
    const html = renderToStaticMarkup(createElement(ModifiedBy, { name: "Jean Kasa", functionLabel: "Préfet d'études", at: "2026-11-26T09:05:00.000Z", verb: "Publié" }));
    expect(html).toContain("Publié par Jean Kasa, Préfet d&#x27;études le 26/11/2026 à");
    expect(renderToStaticMarkup(createElement(ModifiedBy, {}))).toBe("");
  });

  it("affectation : le premier gagne, le même compte peut réenregistrer", () => {
    const snapshot = (data?: Record<string, unknown>) => ({ exists: () => Boolean(data), data: () => data });
    expect(() => assertAssignmentUnchanged(snapshot({ updatedAt: "B", updatedBy: "autre" }), { updatedAt: "A" }, "moi")).toThrow(AssignmentAlreadyModified);
    expect(() => assertAssignmentUnchanged(snapshot({ updatedAt: "A", updatedBy: "autre" }), { updatedAt: "A" }, "moi")).not.toThrow();
    expect(() => assertAssignmentUnchanged(snapshot({ updatedAt: "B", updatedBy: "moi" }), { updatedAt: "A" }, "moi")).not.toThrow();
    expect(() => assertAssignmentUnchanged(snapshot({ updatedAt: "B", updatedBy: "autre" }), { updatedAt: "" }, "moi")).not.toThrow();
  });
});
