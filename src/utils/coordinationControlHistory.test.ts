import { describe, expect, it, vi } from "vitest";
import type { Expense, Payment, School, SchoolYear } from "../types";
import { controlHistoryCurrency, defaultControlHistoryDate, matchesControlHistory } from "./coordinationControlHistory";
describe("Historique Contrôle — filtres export et écran", () => {
  it("préremplit les deux bornes avec le jour local métier", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
      expect(defaultControlHistoryDate()).toBe(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
    } finally { vi.useRealTimers(); }
  });
  it.each(["paidAt", "spentAt"])("filtre école et bornes inclusives sur %s", (field) => {
    const operation = (schoolId: string, date: string) => ({ schoolId, [field]: date } as unknown as Payment | Expense);
    const filters = { schoolId: "b", startDate: "2026-10-01", endDate: "2026-10-03" };
    expect(matchesControlHistory(operation("b", "2026-10-03T23:59:59Z"), filters)).toBe(true);
    expect(matchesControlHistory(operation("b", "2026-10-01"), filters)).toBe(true);
    expect(matchesControlHistory(operation("a", "2026-10-02"), filters)).toBe(false);
    expect(matchesControlHistory(operation("b", "2026-10-04"), filters)).toBe(false);
    expect(matchesControlHistory(operation("b", "2026-09-30"), filters)).toBe(false);
  });
  it("privilégie la devise enregistrée puis celle de l'année, sans conversion", () => {
    const schools = [{ id: "b", currency: "USD" }] as School[];
    const years = [{ id: "old", schoolId: "b", currency: "CDF" }] as SchoolYear[];
    expect(controlHistoryCurrency({ schoolId: "b", schoolYearId: "old" } as Payment, schools, years)).toBe("CDF");
    expect(controlHistoryCurrency({ schoolId: "b", schoolYearId: "old", currency: "USD" } as Payment, schools, years)).toBe("USD");
  });
});
