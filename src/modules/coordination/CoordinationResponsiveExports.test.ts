import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const students = readFileSync(new URL("./CoordinationStudents.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("./CoordinationControl.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("./CoordinationMenu.tsx", import.meta.url), "utf8");
const subCoordinations = readFileSync(new URL("./SubCoordinationManagement.tsx", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../../components/ui/AdminDrawer.tsx", import.meta.url), "utf8");

describe("responsive et exports Coordination", () => {
  it("affiche les deux téléchargements compacts et accessibles dans Élèves et Contrôle", () => {
    for (const source of [students, control]) {
      expect(source).toContain("Télécharger les paiements PDF");
      expect(source).toContain("Télécharger les dépenses PDF");
      expect(source).toContain("exportCoordinationFinancialTransactions");
      expect(source).toContain('type="button"');
      expect(source).not.toContain("createPaymentTransaction");
      expect(source).not.toContain("createExpenseTransaction");
    }
  });

  it("alimente les exports avec les élèves réellement filtrés et les données déjà chargées", () => {
    expect(students).toContain("students,\n      payments: model.payments");
    expect(students).toContain("selectedSchoolId");
    expect(control).toContain("students: rows.map((row) => row.student)");
    expect(control).toContain("payments: model.payments");
    expect(control).toContain("expenses: model.expenses");
  });

  it("empile les commandes mobiles et réserve les colonnes denses au très grand écran", () => {
    expect(students).toContain("grid-cols-1 items-stretch gap-2 sm:grid-cols-2 xl:grid-cols-");
    expect(control).toContain("grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-");
    expect(control).not.toContain("lg:flex lg:flex-nowrap");
  });

  it("utilise la variante large pour les tableaux sans élargir les formulaires simples", () => {
    expect(drawer).toContain('width?: "default" | "wide"');
    expect(menu).toContain('width={drawer === "settings" ? "default" : "wide"}');
    expect(menu).toContain('<AdminDrawer width="wide" title={`Personnel');
    expect(control).toContain('<AdminDrawer width="wide" title="Historique du contrôle"');
    expect(subCoordinations).toContain('<AdminDrawer title="Créer sous-coordination"');
  });

  it("garde les tableaux dans leur propre zone de défilement et les formulaires mobiles sur une colonne", () => {
    expect(menu).toContain('className="max-w-full overflow-x-auto"');
    expect(control).toContain('className="max-w-full overflow-x-auto"');
    expect(menu).toContain('className="grid gap-2 sm:grid-cols-2"');
    expect(subCoordinations).toContain('className="grid grid-cols-1 gap-2 sm:grid-cols-2"');
    expect(subCoordinations).toContain("min-w-0 break-words");
  });
});
