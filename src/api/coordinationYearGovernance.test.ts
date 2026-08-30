import { beforeEach, describe, expect, it, vi } from "vitest";

type RecordData = Record<string, unknown>;
type Ref = { path: string; id: string; get: () => Promise<Snapshot> };
type Snapshot = { id: string; exists: boolean; data: () => RecordData | undefined };
const state = vi.hoisted(() => ({ records: new Map<string, RecordData>(), role: "coordination_admin", db: {} as Record<string, unknown>, commits: 0 }));
vi.mock("../../api/_lib/firebaseAdmin.js", () => ({ initAdmin: () => ({ auth: {}, db: state.db }) }));
vi.mock("../../api/_lib/rateLimit.js", () => ({ API_RATE_LIMITS: { SCHOOL_ADMIN: {} }, enforceApiRateLimit: vi.fn(), sendRateLimitError: () => false }));
vi.mock("../../api/_lib/coordination.js", async (original) => ({
  ...await original<Record<string, unknown>>(),
  requireActiveCoordinationActor: async () => ({ uid: "coordinator", role: state.role, coordinationId: "coord-a", profile: { name: "Coordinateur" }, coordination: state.records.get("coordinations/coord-a") }),
}));
import handler from "../../api/manage-coordination-school-years.js";

function snapshot(path: string): Snapshot { return { id: path.split("/").at(-1)!, exists: state.records.has(path), data: () => structuredClone(state.records.get(path)) }; }
function ref(path: string): Ref { return { path, id: path.split("/").at(-1)!, get: async () => snapshot(path) }; }
function collection(path: string, predicates: Array<(data: RecordData) => boolean> = []) {
  return {
    where: (field: string, op: string, value: unknown) => collection(path, [...predicates, (data) => op === "in" ? (value as unknown[]).includes(data[field]) : data[field] === value]),
    get: async () => ({ docs: [...state.records].filter(([key, data]) => key.startsWith(`${path}/`) && predicates.every((check) => check(data))).map(([key]) => snapshot(key)) }),
    doc: (id = "audit-generated") => ref(`${path}/${id}`),
  };
}
async function call(action: string, extra: RecordData = {}) {
  const response = { statusCode: 0, body: {} as RecordData, setHeader: vi.fn(), end(value: string) { this.body = JSON.parse(value); } };
  await handler({ method: "POST", headers: { authorization: "Bearer test-token" }, body: { action, confirmed: true, requestId: `request-${action}-0001`, confirmation: action === "reactivate" ? "REACTIVER LES ANNEES SCOLAIRES" : "CLOTURER LES ANNEES SCOLAIRES", ...extra } }, response);
  return response;
}
function governance() { return state.records.get("coordinations/coord-a")?.yearGovernance as { operationId: string; status: string; years: Array<{ schoolId: string; schoolYearId: string }> }; }

describe("gouvernance Coordination — régression clôture/réactivation", () => {
  beforeEach(() => {
    state.records.clear(); state.commits = 0; state.role = "coordination_admin";
    state.records.set("coordinations/coord-a", { id: "coord-a", status: "active", referenceSchoolYear: "2026-2027" });
    state.records.set("users/coordinator", { role: "coordination_admin", coordinationId: "coord-a", active: true });
    for (const id of ["a", "b"]) {
      state.records.set(`coordinationSchools/coord-a__school-${id}`, { coordinationId: "coord-a", schoolId: `school-${id}`, active: true });
      state.records.set(`schools/school-${id}`, { id: `school-${id}`, name: `École ${id}`, status: "active", activeCoordinationId: "coord-a", activeSchoolYearId: `year-${id}` });
      state.records.set(`schoolYears/year-${id}`, { id: `year-${id}`, schoolId: `school-${id}`, name: "2026-2027", status: "active" });
    }
    state.records.set("schoolYears/old-archive", { schoolId: "school-a", status: "archived", name: "2025-2026" });
    state.records.set("students/student-a", { schoolId: "school-a", schoolYearId: "year-a", name: "Historique préservé" });
    let tail = Promise.resolve();
    const transaction = () => {
      const pending: Array<() => void> = [];
      return {
        get: (target: { get: () => Promise<unknown> }) => target.get(),
        getAll: (...refs: Ref[]) => Promise.all(refs.map((item) => item.get())),
        create: (target: Ref, data: RecordData) => { if (state.records.has(target.path)) throw new Error("exists"); pending.push(() => state.records.set(target.path, structuredClone(data))); },
        update: (target: Ref, data: RecordData) => pending.push(() => state.records.set(target.path, { ...state.records.get(target.path), ...structuredClone(data) })),
        set: (target: Ref, data: RecordData) => pending.push(() => state.records.set(target.path, structuredClone(data))),
        commit: async () => { pending.forEach((write) => write()); if (pending.length) state.commits += 1; },
      };
    };
    state.db = { doc: ref, collection, getAll: (...refs: Ref[]) => Promise.all(refs.map((item) => item.get())), batch: transaction,
      runTransaction: (callback: (tx: ReturnType<typeof transaction>) => Promise<unknown>) => {
        const result = tail.then(async () => { const tx = transaction(); const response = await callback(tx); await tx.commit(); return response; });
        tail = result.then(() => undefined, () => undefined); return result;
      },
    };
  });

  it.each(["cloturer les annees scolaires", "CLOTURER LES ANNÉES SCOLAIRES", " CLOTURER LES ANNEES SCOLAIRES", "CLOTURER LES ANNEES SCOLAIRES ", ""])("refuse la clôture sans phrase exacte : %s", async (confirmation) => {
    expect((await call("close", { confirmation })).statusCode).toBe(400);
    expect(state.commits).toBe(0);
  });
  it("persiste une cohorte précise, expose son état et conserve les archives", async () => {
    expect((await call("close")).statusCode).toBe(200);
    expect(governance()).toMatchObject({ status: "closed", years: [{ schoolId: "school-a", schoolYearId: "year-a" }, { schoolId: "school-b", schoolYearId: "year-b" }] });
    expect(state.records.get("schoolYears/old-archive")?.status).toBe("archived");
    expect((await call("status")).body).toMatchObject({ governance: { status: "closed" } });
  });
  it.each(["reactiver les annees scolaires", "RÉACTIVER LES ANNÉES SCOLAIRES", " REACTIVER LES ANNEES SCOLAIRES", "REACTIVER LES ANNEES SCOLAIRES "])("refuse la réactivation non exacte : %s", async (confirmation) => {
    await call("close");
    expect((await call("reactivate", { confirmation, operationId: governance()?.operationId })).statusCode).toBe(400);
    expect(state.records.get("schoolYears/year-a")?.status).toBe("archived");
  });
  it("réactive uniquement la cohorte sans toucher les données historiques", async () => {
    const history = structuredClone(state.records.get("students/student-a"));
    await call("close");
    expect((await call("reactivate", { operationId: governance()?.operationId })).statusCode).toBe(200);
    expect(governance().status).toBe("reactivated");
    expect(state.records.get("schoolYears/year-a")?.status).toBe("active");
    expect(state.records.get("schools/school-a")?.activeSchoolYearId).toBe("year-a");
    expect(state.records.get("schoolYears/old-archive")?.status).toBe("archived");
    expect(state.records.get("students/student-a")).toEqual(history);
  });
  it("refuse atomiquement un conflit avec une nouvelle année active", async () => {
    await call("close");
    state.records.set("schoolYears/new-b", { schoolId: "school-b", status: "active" });
    state.records.get("schools/school-b")!.activeSchoolYearId = "new-b";
    expect((await call("reactivate", { operationId: governance()?.operationId })).statusCode).toBe(409);
    expect(state.records.get("schoolYears/year-a")?.status).toBe("archived");
    expect(governance().status).toBe("closed");
  });
  it("refuse toute clôture partielle si une école est incohérente", async () => {
    state.records.get("schools/school-b")!.activeSchoolYearId = "invalid";
    expect((await call("close")).statusCode).toBe(409);
    expect(state.records.get("schoolYears/year-a")?.status).toBe("active");
    expect(state.commits).toBe(0);
  });
  it("sérialise les doubles soumissions sans audit ni mutation en double", async () => {
    const results = await Promise.all([call("close"), call("close")]);
    expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
    expect(state.commits).toBe(1);
    expect([...state.records.keys()].filter((key) => key.startsWith("auditLogs/"))).toHaveLength(1);
  });
  it("refuse la réactivation après retrait d’une école du périmètre", async () => {
    await call("close");
    state.records.get("coordinationSchools/coord-a__school-b")!.active = false;
    expect((await call("reactivate", { operationId: governance()?.operationId })).statusCode).toBe(409);
    expect(state.records.get("schoolYears/year-a")?.status).toBe("archived");
  });
  it.each(["close", "reactivate", "open"])("refuse %s au Sous-coordinateur", async (action) => {
    state.role = "sub_coordination_admin";
    expect((await call(action)).statusCode).toBe(403);
    expect(state.commits).toBe(0);
  });
  it("ouvre la nouvelle année après clôture et termine l’état de blocage", async () => {
    await call("close");
    expect((await call("open", { name: "2027-2028", startsAt: "2027-09-01", endsAt: "2028-07-31" })).statusCode).toBe(200);
    expect(governance().status).toBe("superseded");
    expect(state.records.get("schoolYears/school-a__2027-2028")?.status).toBe("active");
    expect(state.records.get("schoolYears/year-a")?.status).toBe("archived");
    expect((await call("reactivate", { operationId: governance()?.operationId })).statusCode).toBe(409);
  });
});
