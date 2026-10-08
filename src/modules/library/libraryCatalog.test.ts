import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LibraryDrawer } from "./LibraryDrawer";
import { libraryDescription, libraryResources, selectLibraryResources } from "./libraryCatalog";

describe("Bibliothèque — catalogue unique", () => {
  it("utilise onze ressources uniques et filtre les trois rôles sans les dupliquer", () => {
    expect(libraryResources).toHaveLength(11);
    expect(new Set(libraryResources.map((resource) => resource.id)).size).toBe(11);
    expect(selectLibraryResources("study_director")).toHaveLength(9);
    expect(selectLibraryResources("teacher")).toHaveLength(9);
    expect(selectLibraryResources("parent")).toHaveLength(7);
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
    expect(selectLibraryResources("parent", { language: "Anglais" }).map((resource) => resource.id)).toEqual(["homeschool-123"]);
    expect(selectLibraryResources("teacher", { origin: "RDC" }).map((resource) => resource.id)).toEqual(["minedu-nc", "programmes-rdc", "documentation-rdc"]);
    expect(selectLibraryResources("parent", { accessType: "Gratuit + payant" }).map((resource) => resource.id)).toEqual(["pass-education"]);
    expect(selectLibraryResources("parent", { query: "introuvable" })).toEqual([]);
  });

  it("exclut une ressource désactivée et limite tous les liens au catalogue HTTPS", () => {
    const disabled = { ...libraryResources[0], enabled: false };
    expect(selectLibraryResources("parent", {}, [disabled, libraryResources[1]]).map((resource) => resource.id)).toEqual(["programmes-rdc"]);
    expect(new Set(libraryResources.map((resource) => resource.url)).size).toBe(libraryResources.length);
    for (const resource of libraryResources) expect(new URL(resource.url).protocol).toBe("https:");
  });
});

describe("Bibliothèque — Drawer et menus", () => {
  it("garde la largeur standard du Drawer et une seule colonne de ressources pour chaque rôle", () => {
    for (const audience of ["study_director", "teacher", "parent"] as const) {
      const markup = renderToStaticMarkup(createElement(LibraryDrawer, { audience, onClose: () => undefined }));
      expect(markup).toContain("sm:max-w-xl");
      expect(markup).not.toContain("sm:max-w-3xl");
      expect(markup.match(/class="grid min-w-0 grid-cols-1 gap-3"/g)).toHaveLength(2);
      expect(markup).not.toContain("md:grid-cols-2");
      expect(markup.match(/<article /g)).toHaveLength(selectLibraryResources(audience).length);
    }
  });

  it("rend les liens externes sécurisés, la distinction RDC et les contrôles de recherche", () => {
    const markup = renderToStaticMarkup(createElement(LibraryDrawer, { audience: "parent", onClose: () => undefined }));
    expect(markup).toContain("Ressources officielles de la RDC");
    expect(markup).toContain("Ressources éducatives complémentaires");
    expect(markup).toContain("Rechercher une ressource");
    expect(markup).toContain("Filtres");
    expect(markup).toContain("Visiter le site");
    expect(markup).toContain('target="_blank"');
    expect(markup.match(/rel="noopener noreferrer"/g)).toHaveLength(7);
    expect(markup).not.toContain("Lumni Enseignement");
    expect(markup).toContain("votre enfant");
  });

  it("ouvre le même Drawer depuis les trois menus, sans l'ajouter aux autres rôles", () => {
    const study = readFileSync(new URL("../studies/StudyDirectorPortal.tsx", import.meta.url), "utf8");
    const teacher = readFileSync(new URL("../teacher/TeacherPortal.tsx", import.meta.url), "utf8");
    const parent = readFileSync(new URL("../parent/ParentPortal.tsx", import.meta.url), "utf8");
    expect(study).toContain('setDrawer("library")');
    expect(study).toContain('<LibraryDrawer audience="study_director"');
    expect(teacher).toContain("setLibraryOpen(true)");
    expect(teacher).toContain('<LibraryDrawer audience="teacher"');
    expect(parent).toContain("setParentLibraryOpen(true)");
    expect(parent).toContain('<LibraryDrawer audience="parent"');
    for (const source of [study, teacher, parent]) expect(source).toContain("Bibliothèque");
    const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(app).not.toContain("LibraryDrawer");
  });
});
