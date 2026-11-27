import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/staffLabels", () => ({
  cachedStaffLabel: () => ({ name: "Jean Kasa", functionLabel: "Préfet d'études" }),
  loadStaffLabels: async () => ({}),
}));
const { SectionManagedBy } = await import("./SectionManagedBy");

// Lot R6 : « Géré par [nom, fonction] » à la place des boutons de réglage d'une section confiée à un autre responsable.
const show = (currentUserId: string, section: "Secondaire" | "CTEB" = "Secondaire") =>
  renderToStaticMarkup(createElement(SectionManagedBy, { schoolId: "school-a", section, currentUserId, managers: { Secondaire: { userId: "prefect" } } }));

describe("lot R6 : « Géré par [nom, fonction] »", () => {
  it("s'affiche pour les autres comptes", () => {
    expect(show("director")).toContain("Géré par Jean Kasa, Préfet d&#x27;études");
  });
  it("jamais pour le responsable lui-même ni pour une section sans responsable désigné", () => {
    expect(show("prefect")).toBe("");
    expect(show("director", "CTEB")).toBe("");
  });
});
