// Années « … (ne pas utiliser) » cachées partout ; ordre : année active, puis de la plus récente à la plus ancienne.
import { describe, expect, it, vi } from "vitest";
vi.mock("../firebase", () => ({ db: undefined }));
import type { School, SchoolYear } from "../types";
import { isHiddenSchoolYear, orderSchoolYears } from "./schoolYears";
import { coordinationActiveYearLabel, coordinationYearChoices } from "../services/coordinationStudentPagination";

const year = (id: string, name: string, status = "archived", startsAt = "") => ({ id, schoolId: "s", name, status, startsAt, endsAt: "" }) as SchoolYear;
// Données réelles de C.S LUMBULA après correction (dates d'origine parfois fausses : l'ordre suit le nom).
const years = [year("dup", "Doublon vide 2026-2027 (ne pas utiliser)", "archived", "2026-09-01"), year("active", "2026-2027", "active", "2026-09-01"),
  year("old", "2025-2026", "archived", "2025-09-01"), year("essai", "Essai 2027-2028 (ne pas utiliser)", "archived", "2027-09-01"), year("older", "2024-2025", "archived", "2027-01-01")];

describe("années cachées et ordre des listes", () => {
  it("une année marquée « (ne pas utiliser) » ou « hidden » est cachée", () => {
    expect(isHiddenSchoolYear({ name: "Essai 2027-2028 (ne pas utiliser)" })).toBe(true);
    expect(isHiddenSchoolYear({ name: "2026-2027", hidden: true })).toBe(true);
    expect(isHiddenSchoolYear({ name: "2026-2027" })).toBe(false);
  });
  it("école (tous les rôles) : année active, puis les autres, jamais une année cachée", () => {
    expect(orderSchoolYears(years, "active").map((y) => y.name)).toEqual(["2026-2027", "2025-2026", "2024-2025"]);
  });
  it("Coordination : « 2026-2027 (année active) », puis de la plus récente à la plus ancienne, sans année cachée", () => {
    const schools = [{ id: "s", activeSchoolYearId: "active" } as School];
    // Premier choix unique « 2026-2027 (année active) », puis les années passées, puis « Toutes les années » (écran).
    expect(coordinationActiveYearLabel(years, schools)).toBe("2026-2027 (année active)");
    expect(coordinationYearChoices(years, schools).map((c) => c.label)).toEqual(["2025-2026", "2024-2025"]);
  });
});
