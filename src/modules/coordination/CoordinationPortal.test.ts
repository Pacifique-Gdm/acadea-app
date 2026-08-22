import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CoordinationPortal.tsx", import.meta.url), "utf8");

describe("portail Coordination", () => {
  it("déclare exactement les cinq onglets métier dans l'ordre attendu", () => {
    expect(source).toContain('["dashboard", "Dashboard", LayoutDashboard]');
    expect(source).toContain('["students", "Élèves", GraduationCap]');
    expect(source).toContain('["control", "Contrôle", Banknote]');
    expect(source).toContain('["messages", "Message", MessageSquare]');
    expect(source).toContain('["menu", "Menu", Menu]');
    expect(source).toContain("grid-cols-5");
    const labels = ["Dashboard", "Élèves", "Contrôle", "Message", "Menu"];
    labels.reduce((cursor, label) => {
      const next = source.indexOf(`"${label}"`, cursor + 1);
      expect(next).toBeGreaterThan(cursor);
      return next;
    }, -1);
  });
  it("retire la déconnexion du Header et la délègue au Menu", () => {
    const header = source.slice(source.indexOf("<header"), source.indexOf("</header>"));
    expect(header).not.toContain("Déconnexion");
    expect(source).toContain("onLogout={onLogout}");
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
