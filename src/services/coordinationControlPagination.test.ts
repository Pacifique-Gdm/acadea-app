import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeeType, School, Student } from "../types";
import type { CoordinationStudentFilters } from "./coordinationStudentPagination";
const mocks = vi.hoisted(() => ({ arrears: vi.fn(), loadPage: vi.fn(), getDocs: vi.fn(), where: vi.fn((field, op, value) => ({ field, op, value })), query: vi.fn((...parts) => parts), collection: vi.fn((_db, name) => name), documentId: vi.fn(() => "id") }));
vi.mock("../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => mocks);
vi.mock("./coordinationStudentPagination", () => ({ COORDINATION_STUDENT_PAGE_SIZE: 50, loadCoordinationStudentPage: mocks.loadPage }));
vi.mock("./coordinationService", () => ({ loadCoordinationStudentArrearsBatch: mocks.arrears }));
import { loadControlPagePayments, loadCoordinationControlPage } from "./coordinationControlPagination";
const filters: CoordinationStudentFilters = { schools: [{ id: "school", currency: "USD" } as School], years: [], selectedSchoolId: "", selectedYearId: "", filterSchoolId: "", search: "", status: "all", className: "", option: "", allowedSections: [] };
const student = (i: number): Student => ({ id: `s${i}`, schoolId: "school", schoolYearId: "year", className: "2ème Primaire" } as Student);
const fees: FeeType[] = [{ id: "fee", schoolId: "school", schoolYearId: "year", name: "Minerval", amount: 100 }, { id: "foreign", schoolId: "other", schoolYearId: "year", name: "Hors périmètre", amount: 999 }];
describe("Contrôle — pagination réelle et finances groupées", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getDocs.mockResolvedValue({ docs: [] }); });
  it("ne lit les paiements que par lots de 30 élèves et par école/année", async () => {
    await loadControlPagePayments(Array.from({ length: 50 }, (_, i) => student(i)));
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(mocks.where).toHaveBeenCalledWith("schoolId", "==", "school");
    expect(mocks.where).toHaveBeenCalledWith("schoolYearId", "==", "year");
    expect(mocks.where.mock.calls.filter(([field]) => field === "studentId").map(([, , ids]) => ids.length)).toEqual([30, 20]);
  });
  it("50 puis 21 puis retour, sans charger les 71 élèves avant la première page", async () => {
    mocks.loadPage.mockImplementation(async (_filters, cursor) => ({ students: Array.from({ length: cursor ? 21 : 50 }, (_, i) => student(i + (cursor ? 50 : 0))), fetchedDocuments: cursor ? 21 : 50, nextCursor: cursor ? undefined : { id: "s49" } }));
    const first = await loadCoordinationControlPage(filters, fees, { comparator: "", threshold: "" });
    expect(first.rows).toHaveLength(50); expect(mocks.loadPage).toHaveBeenCalledTimes(1);
    expect(first.rows[0].balance).toEqual({ expected: 100, paid: 0, remaining: 100 });
    const second = await loadCoordinationControlPage(filters, fees, { comparator: "", threshold: "" }, first.nextCursor);
    expect(second.rows).toHaveLength(21); expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.rows, ...second.rows].map((row) => row.student.id)).size).toBe(71);
    const back = await loadCoordinationControlPage(filters, fees, { comparator: "", threshold: "" });
    expect(back.rows).toEqual(first.rows);
    expect(mocks.arrears).not.toHaveBeenCalled();
  });
  it("remplit une page filtrée au-delà de la première page source et conserve le reliquat", async () => {
    mocks.loadPage.mockImplementation(async (_filters, cursor) => {
      const offset = cursor ? Number(cursor.id) : 0;
      return { students: Array.from({ length: 50 }, (_, i) => student(offset + i)), fetchedDocuments: 50, nextCursor: offset === 100 ? undefined : { id: String(offset + 50) } };
    });
    mocks.getDocs.mockImplementation(async (parts) => ({ docs: parts.find((part: { field?: string }) => part.field === "studentId").value.filter((id: string) => Number(id.slice(1)) >= 45).map((id: string) => ({ id: `p${id}`, data: () => ({ studentId: id, feeTypeId: "fee", amount: 50 }) })) }));
    const first = await loadCoordinationControlPage(filters, fees, { comparator: "all-fees-gte", threshold: "50" });
    expect(first.rows).toHaveLength(50); expect(first.rows[0].student.id).toBe("s45"); expect(first.rows[49].student.id).toBe("s94");
    const second = await loadCoordinationControlPage(filters, fees, { comparator: "all-fees-gte", threshold: "50" }, first.nextCursor);
    expect(second.rows[0].student.id).toBe("s95"); expect(second.rows).toHaveLength(50);
    const third = await loadCoordinationControlPage(filters, fees, { comparator: "all-fees-gte", threshold: "50" }, second.nextCursor);
    expect(third.rows.map((row) => row.student.id)).toEqual(["s145", "s146", "s147", "s148", "s149"]);
    expect(third.nextCursor).toBeUndefined();
  });
  it("trouve les arriérés après les 50 premiers élèves sans N+1 et conserve le curseur", async () => {
    mocks.loadPage.mockImplementation(async (_filters, cursor) => {
      const offset = cursor ? Number(cursor.id) : 0;
      return { students: Array.from({ length: 50 }, (_, i) => student(offset + i)), fetchedDocuments: 50, nextCursor: offset === 100 ? undefined : { id: String(offset + 50) } };
    });
    mocks.arrears.mockImplementation(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { USD: Number(id.slice(1)) >= 50 ? 65 : 0, CDF: 9000 }])));
    const filter = { minimum: "65", maximum: "66" };
    const first = await loadCoordinationControlPage(filters, fees, { comparator: "", threshold: "" }, undefined, filter);
    expect(first.rows.map((row) => row.student.id)).toEqual(Array.from({ length: 50 }, (_, i) => `s${50 + i}`));
    expect(mocks.arrears).toHaveBeenCalledTimes(2);
    const next = await loadCoordinationControlPage(filters, fees, { comparator: "", threshold: "" }, first.nextCursor, filter);
    expect(next.rows).toHaveLength(50); expect(next.rows[0].student.id).toBe("s100"); expect(next.nextCursor).toBeUndefined();
    expect(mocks.arrears).toHaveBeenCalledTimes(3);
  });
});
