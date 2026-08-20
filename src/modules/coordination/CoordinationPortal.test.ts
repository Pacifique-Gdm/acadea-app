import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CoordinationPortal.tsx", import.meta.url), "utf8");

describe("portail Coordination Phase 1", () => {
  it("déclare exactement les quatre onglets métier", () => {
    expect(source).toContain('["dashboard", "Dashboard", LayoutDashboard]');
    expect(source).toContain('["students", "Élèves", GraduationCap]');
    expect(source).toContain('["messages", "Message", MessageSquare]');
    expect(source).toContain('["menu", "Menu", Menu]');
    expect(source).not.toContain("Contrôle");
  });
  it("partage la route entre Coordinateur et Sous-coordinateur avec leurs claims obligatoires", () => {
    expect(source).toContain('["coordination_admin", "sub_coordination_admin"].includes(user.role)');
    expect(source).toContain("user.coordinationId");
    expect(source).toContain("user.subCoordinationId");
  });
  it("écoute uniquement les relations actives de la Coordination", () => {
    expect(source).toContain('where("coordinationId", "==", coordinationId)');
    expect(source).toContain('where("active", "==", true)');
    expect(source).toContain('where("subCoordinationId", "==", user.subCoordinationId!)');
    expect(source).toContain('where("coordinationId", "==", coordinationId)');
  });
});
