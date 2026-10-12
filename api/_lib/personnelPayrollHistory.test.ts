import { describe, expect, it, vi } from "vitest";
import { listPersonnelPayrollHistory } from "./personnelPayrollHistory.js";

vi.mock("./coordination.js", () => ({
  resolveCoordinationSchoolScope: async (_db: unknown, actor: { role: string }) => actor.role === "sub_coordination_admin" ? ["school-a"] : ["school-a", "school-b"],
}));

function database(items: Array<Record<string, unknown>> = [], role = "cashier") {
  const filters: Array<[string, string, unknown]> = [];
  const query = {
    where(field: string, operator: string, value: unknown) { filters.push([field, operator, value]); return this; },
    orderBy() { return this; }, startAfter() { return this; }, limit() { return this; },
    async get() { return { docs: items.map((item) => ({ id: item.id, data: () => item })) }; },
  };
  return {
    filters,
    doc: (path: string) => ({ path, get: async () => ({ exists: true, data: () => ({ role, schoolId: "school-a" }) }) }),
    collection: () => query,
  };
}

const payment = (id: string, schoolId = "school-a", kind = "salary") => ({ id, schoolId, schoolYearId: "year-a", kind, paidAt: "2026-10-10", beneficiaryId: "staff-a", beneficiaryName: "Personnel fictif", beneficiaryJobTitle: "Enseignant", netPaid: 50, amount: 50, recoveredAmount: 0, recoveries: [], deduction: 0, cnss: 0, tax: 0, createdAt: "2026-10-10T10:00:00.000Z", currency: "CDF", reference: id, periodMonth: 9, periodYear: 2026, clientRequestIdHash: "private" });

describe("historique sécurisé des salaires et primes", () => {
  it("limite le Caissier à son école, fournit les champs PDF et exclut les champs internes", async () => {
    const db = database([payment("salary-a"), payment("foreign", "school-b"), payment("advance-a", "school-a", "advance")]);
    const result = await listPersonnelPayrollHistory({ db, actor: { uid: "cashier-a", role: "cashier", schoolId: "school-a" }, body: { action: "list-payroll-history" } });
    expect(result.payments.map((item: { id: string }) => item.id)).toEqual(["salary-a"]);
    expect(result.payments[0]).toMatchObject({ amount: 50, netPaid: 50, recoveries: [], beneficiaryId: "staff-a" });
    expect(result.payments[0]).not.toHaveProperty("clientRequestIdHash");
    expect(db.filters).toContainEqual(["schoolId", "in", ["school-a"]]);
    expect(db.filters).toContainEqual(["kind", "in", ["salary", "bonus"]]);
  });

  it("refuse une école étrangère et un rôle non autorisé", async () => {
    const db = database();
    await expect(listPersonnelPayrollHistory({ db, actor: { uid: "cashier-a", role: "cashier", schoolId: "school-a" }, body: { action: "list-payroll-history", schoolId: "school-b" } })).rejects.toMatchObject({ status: 403 });
    await expect(listPersonnelPayrollHistory({ db, actor: { uid: "teacher-a", role: "teacher", schoolId: "school-a" }, body: { action: "list-payroll-history" } })).rejects.toMatchObject({ status: 403 });
  });

  it("applique le périmètre délégué de la Sous-coordination", async () => {
    const db = database([payment("salary-a"), payment("foreign", "school-b")]);
    const actor = { uid: "sub-a", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" };
    const result = await listPersonnelPayrollHistory({ db, actor, body: { action: "list-payroll-history" } });
    expect(result.payments.map((item: { id: string }) => item.id)).toEqual(["salary-a"]);
    await expect(listPersonnelPayrollHistory({ db, actor, body: { action: "list-payroll-history", schoolId: "school-b" } })).rejects.toMatchObject({ status: 403 });
  });

  it("autorise l'Administrateur de l'école mais refuse une divergence de rôle", async () => {
    const actor = { uid: "admin-a", role: "school_admin", schoolId: "school-a" };
    expect((await listPersonnelPayrollHistory({ db: database([payment("bonus-a", "school-a", "bonus")], "school_admin"), actor, body: { action: "list-payroll-history" } })).payments).toHaveLength(1);
    await expect(listPersonnelPayrollHistory({ db: database([], "cashier"), actor, body: { action: "list-payroll-history" } })).rejects.toMatchObject({ status: 403 });
  });

  it("borne la page à 50 paiements et retourne un curseur", async () => {
    const items = Array.from({ length: 51 }, (_, index) => payment(`pay-${String(index).padStart(3, "0")}`));
    const result = await listPersonnelPayrollHistory({ db: database(items), actor: { uid: "cashier-a", role: "cashier", schoolId: "school-a" }, body: { action: "list-payroll-history" } });
    expect(result.payments).toHaveLength(50);
    expect(result.nextCursor).toEqual({ paidAt: "2026-10-10", id: "pay-001" });
  });
});
