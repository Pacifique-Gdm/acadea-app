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
  it("refuse un rôle autre que coordination_admin", () => {
    expect(source).toContain('user.role !== "coordination_admin"');
    expect(source).toContain("user.coordinationId");
  });
  it("écoute uniquement les relations actives de la Coordination", () => {
    expect(source).toContain('where("coordinationId", "==", coordinationId)');
    expect(source).toContain('where("active", "==", true)');
  });
});
