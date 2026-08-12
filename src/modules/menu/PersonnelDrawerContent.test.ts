import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/menu/PersonnelDrawerContent.tsx", "utf8");

describe("Drawer Personnels", () => {
  it("présente les actifs par défaut, le filtre archives et une liste responsive", () => {
    expect(source).toContain('useState<"active" | "archived">("active")');
    expect(source).toContain(">Actifs</button>");
    expect(source).toContain(">Archivés</button>");
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
});
