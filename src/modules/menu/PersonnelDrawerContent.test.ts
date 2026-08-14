import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/menu/PersonnelDrawerContent.tsx", "utf8");

describe("Drawer Personnels", () => {
  it("présente les actifs par défaut, le filtre archives et une liste responsive", () => {
    expect(source).toContain('useState<"active" | "archived">("active")');
    expect(source).toContain('aria-haspopup="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain("Actifs</button>");
    expect(source).toContain("Archivés</button>");
    expect(source).toContain("sm:grid-cols-[minmax(0,1fr)_auto]");
  });

  it("protège les actions par confirmation, chargement et rôle administrateur", () => {
    expect(source).toContain('setConfirming("archive")');
    expect(source).toContain('setConfirming("reactivate")');
    expect(source).toContain('selected.role !== "school_admin"');
    expect(source).not.toContain("Archivage réservé au Super Administrateur");
    expect(source).toContain("<MultiSelectDropdown label=\"Sections\"");
    expect(source).toContain("disabled={busy}");
  });

  it("ferme les deux menus au clic extérieur et conserve le filtre sélectionné", () => {
    expect(source).toContain("useDismissibleDropdown(() => setStatusOpen(false))");
    expect(source).toContain("useDismissibleDropdown<HTMLButtonElement>(() => setActionsOpen(false))");
    expect(source).toContain('setView("archived"); setStatusOpen(false)');
  });

  it("imprime exactement la liste visible dans une seconde colonne", () => {
    expect(source).toContain("grid min-w-0 grid-cols-2 gap-2");
    expect(source).toContain("printPersonnelListPdf(school, visible, view)");
  });

  it("regroupe les actions autorisées et conserve Imprimer dans une seconde colonne", () => {
    expect(source).toContain('className="grid grid-cols-2 gap-2"');
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain("Modifier</button>");
    expect(source).toContain("Archiver</button>");
    expect(source).toContain("printPersonnelProfilePdf(school, selected, profile)");
    expect(source).toContain("Imprimer</button>");
    expect(source).toContain('selected.role === "school_admin"');
  });
});
