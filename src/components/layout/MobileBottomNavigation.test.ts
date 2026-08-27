import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./MobileBottomNavigation.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const consumers = [
  "./BottomNavigation.tsx",
  "./SecretaryBottomNavigation.tsx",
  "./StudyDirectorBottomNavigation.tsx",
  "./TeacherBottomNavigation.tsx",
  "./ParentBottomNavigation.tsx",
  "./DisciplineBottomNavigation.tsx",
  "../../modules/platform/PlatformModule.tsx",
  "../../modules/coordination/CoordinationPortal.tsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

describe("navigation mobile commune iPhone et Android", () => {
  it("utilise une grille sans largeur intrinsèque pour chaque nombre d'onglets", () => {
    expect(component).toContain("repeat(${columnCount}, minmax(0, 1fr))");
    expect(component).toContain('className="mobile-bottom-navigation"');
    expect(component).toContain("mobile-bottom-navigation__grid");
    expect(component).toContain("mobile-bottom-navigation__item");
    expect(component).toContain("mobile-bottom-navigation__label");
  });

  it("neutralise l'agrandissement typographique Safari et respecte toutes les safe areas", () => {
    expect(styles).toContain("-webkit-text-size-adjust: 100%");
    expect(styles).toContain("text-size-adjust: 100%");
    expect(styles).toContain("env(safe-area-inset-left)");
    expect(styles).toContain("env(safe-area-inset-right)");
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("min-inline-size: 0");
    expect(styles).toContain("max-inline-size: 100%");
  });

  it("est réutilisée par tous les portails actuels", () => {
    consumers.forEach((source) => expect(source).toContain("<MobileBottomNavigation"));
  });
});
