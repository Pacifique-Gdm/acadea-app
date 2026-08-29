import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CoordinationPortal.tsx", import.meta.url), "utf8");

describe("portail Coordination", () => {
  it("déclare exactement les cinq onglets métier dans l'ordre attendu", () => {
    expect(source).toContain('id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard');
    expect(source).toContain('id: "students" as const, label: "Élèves", icon: GraduationCap');
    expect(source).toContain('id: "control" as const, label: "Contrôle", icon: Banknote');
    expect(source).toContain('id: "messages" as const, label: "Message", icon: MessageSquare');
    expect(source).toContain('id: "menu" as const, label: "Menu", icon: Menu');
    expect(source).toContain("<MobileBottomNavigation");
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
  it("rend l’en-tête sticky avec le logo Coordination persistant et son fallback", () => {
    expect(source).toContain('className="min-h-screen min-w-0 max-w-full');
    expect(source).not.toContain("overflow-x-clip");
    expect(source).toContain('className="sticky top-0 z-20 w-full border-b');
    expect(source).toContain("coordination?.logoUrl");
    expect(source).toContain('src={coordination.logoUrl}');
    expect(source).toContain("<Building2");
    expect(source).toContain('onSnapshot(doc(database, "coordinations", coordinationId)');
  });
});
