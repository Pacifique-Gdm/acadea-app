import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("ordre des neuf menus utilisateurs", () => {
  it.each([
    ["Coordination et Sous-coordination", "../coordination/CoordinationMenu.tsx", 'setDrawer("years")', "LogoutButton onClick={onLogout}"],
    ["Administrateur et Caissier", "./MenuModule.tsx", "setCashierArchiveOpen(true)", "LogoutButton onClick={onLogout}"],
    ["Parent", "../parent/ParentPortal.tsx", "setParentArchiveOpen(true)", "onClick={onLogout}"],
    ["Secrétaire", "../secretary/SecretaryMenuModule.tsx", "setArchiveDrawerOpen(true)", "onClick={onLogout}"],
    ["Directeur des études", "../studies/StudyDirectorPortal.tsx", 'setDrawer("school-years")', "onClick={onLogout}"],
    ["Directeur de Discipline", "../discipline/DisciplinePortal.tsx", "setArchiveOpen(true)", "onClick={onLogout}"],
    ["Enseignant", "../teacher/TeacherPortal.tsx", "setArchiveOpen(true)", "LogoutButton onClick={onLogout}"],
  ])("place Année scolaire avant Déconnexion : %s", (_role, path, archiveAction, logoutAction) => {
    const markup = source(path);
    const archive = markup.lastIndexOf(archiveAction);
    const logout = markup.lastIndexOf(logoutAction);
    expect(archive).toBeGreaterThan(-1);
    expect(logout).toBeGreaterThan(archive);
  });
});
