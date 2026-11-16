import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appVersion } from "./AppVersion";

describe("petit lot « Version »", () => {
  it("le numéro de départ est 1.0.0, au format correction / fonctionnalité / grand changement", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(appVersion).toBe("1.0.0-test");
  });
  it("la version apparaît sous « Déconnexion » dans le Menu de chaque rôle", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    expect(read("./LogoutButton.tsx")).toContain("Déconnexion</button><AppVersion />");
    for (const file of ["../../modules/menu/MenuModule.tsx", "../../modules/coordination/CoordinationMenu.tsx", "../../modules/platform/PlatformModule.tsx", "../../modules/teacher/TeacherPortal.tsx"]) expect(read(file)).toContain("<LogoutButton");
    for (const file of ["../../modules/parent/ParentPortal.tsx", "../../modules/discipline/DisciplinePortal.tsx", "../../modules/secretary/SecretaryMenuModule.tsx", "../../modules/studies/StudyDirectorPortal.tsx"]) expect(read(file)).toContain("<AppVersion />");
  });
});
