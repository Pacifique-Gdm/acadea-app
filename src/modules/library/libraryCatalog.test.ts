import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibraryDrawer } from "./LibraryDrawer";
import { libraryDescription, libraryResources, selectLibraryResources } from "./libraryCatalog";

describe("Bibliothèque — catalogue unique", () => {
  it("préserve les onze ressources initiales et ajoute onze cours uniques pour sept rôles", () => {
    expect(libraryResources).toHaveLength(22);
    expect(new Set(libraryResources.map((resource) => resource.id)).size).toBe(22);
    expect(selectLibraryResources("study_director")).toHaveLength(20);
    expect(selectLibraryResources("school_admin")).toHaveLength(20);
    expect(selectLibraryResources("school_admin").map((resource) => [resource.id, resource.name, libraryDescription(resource, "school_admin"), resource.url, resource.category]))
      .toEqual(selectLibraryResources("study_director").map((resource) => [resource.id, resource.name, libraryDescription(resource, "study_director"), resource.url, resource.category]));
    expect(selectLibraryResources("teacher")).toHaveLength(20);
    expect(selectLibraryResources("parent")).toHaveLength(18);
    for (const audience of ["secretary", "cashier", "discipline_director"] as const) {
      expect(selectLibraryResources(audience)).toHaveLength(11);
      expect(selectLibraryResources(audience).every((resource) => resource.order >= 12)).toBe(true);
    }
    expect(selectLibraryResources("teacher").find((resource) => resource.id === "khan-fr"))
      .toBe(selectLibraryResources("parent").find((resource) => resource.id === "khan-fr"));
    expect(selectLibraryResources("parent").some((resource) => resource.id === "lumni-enseignement")).toBe(false);
  });

  it("place les ressources officielles RDC avant les ressources complémentaires", () => {
    for (const audience of ["study_director", "teacher", "parent"] as const) {
      const resources = selectLibraryResources(audience);
      expect(resources.slice(0, 2).map((resource) => resource.id)).toEqual(["minedu-nc", "programmes-rdc"]);
      expect(resources.findIndex((resource) => !resource.official)).toBeGreaterThan(1);
      expect(resources.every((resource, index) => index === 0 || resources[index - 1].order <= resource.order)).toBe(true);
    }
    expect(libraryResources.filter((resource) => resource.official).every((resource) => resource.origin === "RDC")).toBe(true);
  });

  it("cherche dans la description réellement affichée et applique les filtres locaux", () => {
    const programme = libraryResources.find((resource) => resource.id === "programmes-rdc")!;
    expect(libraryDescription(programme, "parent")).toContain("votre enfant");
    expect(selectLibraryResources("parent", { query: "votre enfant" }).map((resource) => resource.id)).toContain("programmes-rdc");
    expect(selectLibraryResources("teacher", { query: "préparation des cours" }).map((resource) => resource.id)).toContain("lumni-enseignement");
    expect(selectLibraryResources("parent", { language: "Anglais" }).map((resource) => resource.id)).toEqual(["homeschool-123", "british-council"]);
    expect(selectLibraryResources("teacher", { origin: "RDC" }).map((resource) => resource.id)).toEqual(["minedu-nc", "programmes-rdc", "documentation-rdc"]);
    expect(selectLibraryResources("parent", { accessType: "Gratuit + payant" }).map((resource) => resource.id)).toEqual(["pass-education", "wall-street-english", "british-council"]);
    expect(selectLibraryResources("cashier", { category: "Apprendre l'anglais" })).toHaveLength(5);
    expect(selectLibraryResources("cashier", { category: "Apprendre l'informatique" })).toHaveLength(6);
    expect(selectLibraryResources("teacher", { resourceType: "Formation professionnelle" }).map((resource) => resource.id)).toEqual(["computer-technician"]);
    expect(selectLibraryResources("parent", { query: "OpenClassrooms" })).toHaveLength(5);
    expect(selectLibraryResources("parent", { query: "Français / Anglais" })).toHaveLength(4);
    expect(selectLibraryResources("parent", { query: "introuvable" })).toEqual([]);
  });

  it("exclut une ressource désactivée et limite tous les liens au catalogue HTTPS", () => {
    const disabled = { ...libraryResources[0], enabled: false };
    expect(selectLibraryResources("parent", {}, [disabled, libraryResources[1]]).map((resource) => resource.id)).toEqual(["programmes-rdc"]);
    expect(new Set(libraryResources.map((resource) => resource.url)).size).toBe(libraryResources.length);
    for (const resource of libraryResources) expect(new URL(resource.url).protocol).toBe("https:");
    expect(libraryResources.filter((resource) => resource.order >= 12).map((resource) => resource.category)).toEqual([
      ...Array(5).fill("Apprendre l'anglais"), ...Array(6).fill("Apprendre l'informatique"),
    ]);
  });
});

describe("Bibliothèque — Drawer et menus", () => {
  it("garde la largeur standard du Drawer et une seule colonne par catégorie pour chaque rôle", () => {
    for (const audience of ["school_admin", "study_director", "teacher", "parent", "secretary", "cashier", "discipline_director"] as const) {
      const markup = renderToStaticMarkup(createElement(LibraryDrawer, { audience, onClose: () => undefined }));
      expect(markup).toContain("sm:max-w-xl");
      expect(markup).not.toContain("sm:max-w-3xl");
      expect(markup.match(/class="grid min-w-0 grid-cols-1 gap-3"/g)?.length).toBe(new Set(selectLibraryResources(audience).map((resource) => `${resource.official}:${resource.category}`)).size);
      expect(markup).not.toContain("md:grid-cols-2");
      expect(markup.match(/<article /g)).toHaveLength(selectLibraryResources(audience).length);
      expect(markup).toContain("Apprendre l&#x27;anglais");
      expect(markup).toContain("Apprendre l&#x27;informatique");
    }
  });

  it("rend les liens externes sécurisés, la distinction RDC et les contrôles de recherche", () => {
    const markup = renderToStaticMarkup(createElement(LibraryDrawer, { audience: "parent", onClose: () => undefined }));
    expect(markup).toContain("Ressources officielles de la RDC");
    expect(markup).toContain("Ressources éducatives complémentaires");
    expect(markup).toContain("Rechercher une ressource");
    expect(markup).toContain("Filtres");
    expect(markup).toContain("Voir le cours");
    expect(markup).toContain('target="_blank"');
    expect(markup.match(/rel="noopener noreferrer"/g)).toHaveLength(18);
    expect(markup).not.toContain("Lumni Enseignement");
    expect(markup).toContain("votre enfant");
  });

  it("ouvre le même Drawer depuis les sept menus sans créer de module parallèle", () => {
    const study = readFileSync(new URL("../studies/StudyDirectorPortal.tsx", import.meta.url), "utf8");
    const teacher = readFileSync(new URL("../teacher/TeacherPortal.tsx", import.meta.url), "utf8");
    const parent = readFileSync(new URL("../parent/ParentPortal.tsx", import.meta.url), "utf8");
    const menu = readFileSync(new URL("../menu/MenuModule.tsx", import.meta.url), "utf8");
    const secretary = readFileSync(new URL("../secretary/SecretaryMenuModule.tsx", import.meta.url), "utf8");
    const discipline = readFileSync(new URL("../discipline/DisciplinePortal.tsx", import.meta.url), "utf8");
    expect(study).toContain('setDrawer("library")');
    expect(study).toContain('<LibraryDrawer audience="study_director"');
    expect(teacher).toContain("setLibraryOpen(true)");
    expect(teacher).toContain('<LibraryDrawer audience="teacher"');
    expect(parent).toContain("setParentLibraryOpen(true)");
    expect(parent).toContain('<LibraryDrawer audience="parent"');
    expect(menu).toContain('user.role === "cashier" ? "cashier" : "school_admin"');
    expect(secretary).toContain('<LibraryDrawer audience="secretary"');
    expect(discipline).toContain('<LibraryDrawer audience="discipline_director"');
    for (const source of [study, teacher, parent, menu, secretary, discipline]) expect(source).toContain("Bibliothèque");
    const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(app).not.toContain("LibraryDrawer");
  });
});
