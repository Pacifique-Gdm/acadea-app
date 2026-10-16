import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source=readFileSync(new URL("./TeacherPortal.tsx",import.meta.url),"utf8");
describe("Menu Enseignant pédagogique",()=>{
  it("conserve les cartes utiles sans exposer progression ni documents pédagogiques",()=>{for(const label of ["Fiche de cotation","Mes élèves","Mes demandes"])expect(source).toContain(label);for(const label of ["Ma progression pédagogique","Documents pédagogiques","TeacherDocumentsDrawer","documentsOpen","Mes disponibilités"])expect(source).not.toContain(label);});
  it("conserve les deux fonctionnalités hors périmètre",()=>{expect(source).toContain("setGradingOpen(true)");expect(source).toContain("setRequestsOpen(true)");});
  it("affiche les sous-titres des cartes conservées",()=>{expect(source).toContain("Suivi de mes classes");expect(source).toContain("Saisie et consolidation");});
});
