import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";
const mocks = vi.hoisted(() => ({ school: vi.fn(), ledger: vi.fn() }));
vi.mock("./sectionSchoolRecords", () => ({ loadSectionSchoolYear: mocks.school }));
vi.mock("./controlHistory", () => ({ loadControlHistoryPage: mocks.ledger }));
import { loadSectionFinancialReport } from "./sectionFinancialReport";
const user = { id: "a", role: "primary_admin", schoolId: "school", status: "active", sectionIds: ["Primaire"] } as AppUser;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.school.mockResolvedValue({ students: [{ id: "current", schoolYearId: "y" }, { id: "historical", schoolYearId: "old" }], payments: [{ id: "p" }], feeTypes: [], parents: [] });
});
describe("section financial report composition", () => {
  it("keeps school-wide ledgers separate from scoped school fees without losing pages", async () => {
    mocks.ledger.mockImplementation(async (kind, _school, _year, _user, cursor) => ({ items: [{ id: `${kind}-${cursor ? "2" : "1"}` }], lastVisible: cursor ? null : { id: "next" } }));
    const result = await loadSectionFinancialReport(user, "school", "y");
    expect(result.students.map((item) => item.id)).toEqual(["current"]);
    expect(result.payments).toEqual([{ id: "p" }]);
    expect(result.expenses).toHaveLength(2); expect(result.cashInflows).toHaveLength(2);
    expect(mocks.ledger).toHaveBeenCalledTimes(4);
  });
  it("fails closed on foreign context, a failed page or a repeated cursor", async () => {
    await expect(loadSectionFinancialReport(user, "other", "y")).rejects.toThrow();
    expect(mocks.school).not.toHaveBeenCalled();
    mocks.ledger.mockRejectedValue(new Error("refused"));
    await expect(loadSectionFinancialReport(user, "school", "y")).rejects.toThrow("refused");
    mocks.ledger.mockResolvedValue({ items: [], lastVisible: { id: "repeated" } });
    await expect(loadSectionFinancialReport(user, "school", "y")).rejects.toThrow("Pagination");
  });
});
