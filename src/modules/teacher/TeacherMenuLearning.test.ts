import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source=readFileSync(new URL("./TeacherPortal.tsx",import.meta.url),"utf8");
describe("Menu Enseignant pédagogique",()=>{
  it("conserve exactement les cinq cartes attendues",()=>{for(const label of ["Fiche de cotation","Ma progression pédagogique","Mes élèves","Documents pédagogiques","Mes demandes"])expect(source).toContain(label);expect(source).not.toContain("Mes disponibilités");});
  it("conserve les deux fonctionnalités hors périmètre",()=>{expect(source).toContain("setGradingOpen(true)");expect(source).toContain("setRequestsOpen(true)");});
  it("affiche les sous-titres exigés",()=>{expect(source).toContain("Suivi des matières enseignées");expect(source).toContain("Suivi de mes classes");expect(source).toContain("Préparations et ressources");});
});
