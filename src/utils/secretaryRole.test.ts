import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getPlatformSchoolStats } from "./platformSchoolStats";
import type { AppData, AppUser } from "../types";

describe("provisionnement et portail Secrétaire", () => {
  it("ajoute uniquement Secrétaire aux rôles métier créables par l'Administrateur", () => {
    const menu = readFileSync(new URL("../modules/menu/MenuModule.tsx", import.meta.url), "utf8");
    expect(menu).toContain('<option value="cashier">Caissier</option>');
    expect(menu).toContain('<option value="discipline_director">Directeur de Discipline</option>');
    expect(menu).toContain('<option value="secretary">Secrétaire</option>');
    expect(menu).not.toContain('<option value="school_admin">');
  });

  it("compte le Secrétaire dans le total des utilisateurs de l'école", () => {
    const users = [
      { id: "admin", role: "school_admin", schoolId: "school-a" },
      { id: "secretary", role: "secretary", schoolId: "school-a" },
    ] as AppUser[];
    const data = { users, students: [], parents: [] } as unknown as AppData;
    expect(getPlatformSchoolStats("school-a", data).users).toBe(2);
  });

  it("réutilise le Header et expose exactement quatre onglets métier", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const portal = readFileSync(new URL("../modules/secretary/SecretaryPortal.tsx", import.meta.url), "utf8");
    const navigation = readFileSync(new URL("../components/layout/SecretaryBottomNavigation.tsx", import.meta.url), "utf8");
    expect(app).toContain("<SecretaryPortal");
    expect(app).toContain("<Header");
    expect(navigation).toContain('label: "Élèves"');
    expect(navigation).toContain('label: "Correspondance"');
    expect(navigation).toContain('label: "Rapports"');
    expect(navigation).toContain('label: "Menu"');
    expect(portal).toContain('useState<SecretaryTab>("students")');
  });

  it("réutilise le module Élèves avec des capacités Secrétaire restrictives", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    expect(app).toContain("<StudentsModule");
    expect(app).toContain("canCreate: true");
    expect(app).toContain("canEdit: true");
    expect(app).toContain("canArchive: false");
    expect(app).toContain("canReactivate: false");
    expect(app).toContain("canCreateParent: false");
    expect(app).toContain("canManageOptions: false");
    expect(app).toContain("studentImportKey={studentImportKey}");
  });

  it("conserve les paiements en lecture seule et borne les écritures Élèves dans les règles", () => {
    const detail = readFileSync(new URL("../components/students/StudentDetailPage.tsx", import.meta.url), "utf8");
    const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
    expect(detail).toContain('<FormPanel title="Paiements">');
    expect(detail).not.toContain("persistFirestorePatch");
    expect(rules).toContain("allow create: if secretaryStudentCreate()");
    expect(rules).toContain("allow update: if secretaryStudentUpdate()");
    expect(rules).toContain('affectedKeys().hasOnly([\n          "nom", "postnom"');
    expect(rules).toContain('role() == "cashier"');
  });
});
