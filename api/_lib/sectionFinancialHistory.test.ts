import { describe, expect, it } from "vitest";
import { listSectionFinancialHistory } from "./sectionFinancialHistory.js";

const actor = { uid: "section-a", role: "primary_admin", schoolId: "school-a" };

function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ["users/section-a", { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Primaire"] }],
    ["schoolYears/year-a", { schoolId: "school-a", status: "active" }],
    ["students/student-a", { schoolId: "school-a", schoolYearId: "year-a", section: "Primaire" }],
    ["students/student-b", { schoolId: "school-a", schoolYearId: "year-a", section: "Secondaire" }],
    ["payments/payment-a", { schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", amount: 10, createdAt: "2026-10-31T10:00:00Z", clientRequestIdHash: "private" }],
    ["payments/payment-b", { schoolId: "school-a", schoolYearId: "year-a", studentId: "student-b", amount: 20, createdAt: "2026-10-31T09:00:00Z" }],
    ["expenses/expense-a", { schoolId: "school-a", schoolYearId: "year-a", amount: 3, createdAt: "2026-10-31T10:00:00Z", clientRequestIdHash: "private" }],
    ["cashInflows/inflow-a", { schoolId: "school-a", schoolYearId: "year-a", amount: 4, createdAt: "2026-10-31T10:00:00Z", clientRequestIdHash: "private" }],
  ]);
  const snapshot = (path: string) => ({ id: path.split("/").at(-1), exists: records.has(path), data: () => records.get(path) });
  const query = (kind: string, filters: Array<[string, unknown]> = []): {
    where: (field: string, operator: string, value: unknown) => ReturnType<typeof query>;
    orderBy: () => ReturnType<typeof query>;
    startAfter: () => ReturnType<typeof query>;
    limit: () => ReturnType<typeof query>;
    get: () => Promise<{ docs: ReturnType<typeof snapshot>[] }>;
  } => ({
    where: (field, _operator, value) => query(kind, [...filters, [field, value]]),
    orderBy: () => query(kind, filters), startAfter: () => query(kind, filters), limit: () => query(kind, filters),
    get: async () => ({ docs: [...records].filter(([path, data]) => path.startsWith(`${kind}/`)
      && filters.every(([field, value]) => data[field] === value)).map(([path]) => snapshot(path)) }),
  });
  const db = { doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    collection: (kind: string) => query(kind),
    runTransaction: async <T>(operation: (transaction: { get: (ref: { path: string } | ReturnType<typeof query>) => Promise<unknown> }) => Promise<T>) => operation({
      get: async (ref) => "path" in ref ? snapshot(ref.path) : ref.get(),
    }) };
  return { db, records };
}

describe("historique financier des administrateurs de section", () => {
  it("ne rend que les paiements des élèves de la section, sans identifiant interne", async () => {
    const { db } = fixture();
    const result = await listSectionFinancialHistory({ db, caller: actor, body: { action: "list-section-financial-history", kind: "payments", schoolYearId: "year-a" } });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["payment-a"]);
    expect(result.items[0]).not.toHaveProperty("clientRequestIdHash");
  });
  it.each(["expenses", "cashInflows"])("rend l'historique %s global de l'école en lecture seule", async (kind) => {
    const { db } = fixture();
    const result = await listSectionFinancialHistory({ db, caller: actor, body: { action: "list-section-financial-history", kind, schoolYearId: "year-a" } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).not.toHaveProperty("clientRequestIdHash");
  });
  it("refuse une autre école, un compte désactivé et une affectation révoquée", async () => {
    const { db, records } = fixture();
    const body = { action: "list-section-financial-history", kind: "payments", schoolYearId: "year-a" };
    await expect(listSectionFinancialHistory({ db, caller: { ...actor, schoolId: "school-b" }, body })).rejects.toMatchObject({ statusCode: 403 });
    records.set("users/section-a", { role: "primary_admin", schoolId: "school-a", status: "inactive", sectionIds: ["Primaire"] });
    await expect(listSectionFinancialHistory({ db, caller: actor, body })).rejects.toMatchObject({ statusCode: 403 });
    records.set("users/section-a", { role: "primary_admin", schoolId: "school-a", status: "active", sectionIds: ["Secondaire"] });
    const result = await listSectionFinancialHistory({ db, caller: actor, body });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["payment-b"]);
  });
  it("refuse un curseur d'une autre collection ou année", async () => {
    const { db } = fixture();
    await expect(listSectionFinancialHistory({ db, caller: actor, body: { action: "list-section-financial-history", kind: "payments", schoolYearId: "year-a", cursorId: "expense-a" } }))
      .rejects.toMatchObject({ status: 403 });
  });
});
