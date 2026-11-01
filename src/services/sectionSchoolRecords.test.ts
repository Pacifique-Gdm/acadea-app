import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "fictitious-test-token" }));
import { loadSectionSchoolRecords, loadSectionSchoolBootstrap, loadSectionSchoolYear } from "./sectionSchoolRecords";
const user = { id: "actor", role: "primary_admin", schoolId: "a", status: "active", sectionIds: ["Primaire"] } as AppUser;
const record = { id: "class-a", schoolId: "a", schoolYearId: "y", section: "Primaire" };
const page = { schoolId: "a", schoolYearId: "y", items: [record], nextCursorId: null };
afterEach(() => vi.unstubAllGlobals());
describe("transport des lectures scolaires bornées", () => {
  it("accepte le personnel global uniquement dans l'établissement sans exiger une section fictive", async () => {
    const personnel = { id: "staff", schoolId: "a", name: "Test", role: "teacher" };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...page, items: [personnel] }) })));
    expect(await loadSectionSchoolRecords("personnel", user, "a", "y")).toEqual([personnel]);
    personnel.schoolId = "b";
    await expect(loadSectionSchoolRecords("personnel", user, "a", "y")).rejects.toThrow("hors périmètre");
  });
  it("charge la provenance des arriérés et déduplique les deux historiques", async () => {
    const payment = { id: "arrears", schoolId: "a", schoolYearId: "old", collectionSchoolYearId: "y", studentId: "old-pupil", currentStudentId: record.id };
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body);
      if (input.action === "list-section-financial-history") return { ok: true, json: async () => ({ items: input.yearBasis ? [payment] : [], nextCursorId: null }) };
      const items = input.kind === "feeTypes" ? [] : input.schoolYearId === "old"
        ? [{ ...record, id: "old-pupil", schoolYearId: "old" }, { ...record, id: "unrelated", schoolYearId: "old" }] : [record];
      return { ok: true, json: async () => ({ ...page, schoolYearId: input.schoolYearId, items }) };
    }));
    const result = await loadSectionSchoolYear(user, "y");
    expect(result.payments).toEqual([payment]);
    expect(result.students.map((item) => item.id)).toEqual([record.id, "old-pupil"]);
  });
  it("assemble l'année sans annuaire de parents ni comptabilité globale", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const input = JSON.parse(init.body);
      requests.push(input.kind);
      if (input.action === "list-section-financial-history") return { ok: true, json: async () => ({ items: input.yearBasis ? [] : [{ id: "pay", schoolId: "a", schoolYearId: "y", studentId: record.id }], nextCursorId: null }) };
      return { ok: true, json: async () => ({ ...page, items: input.kind === "feeTypes" ? [{ id: "fee", schoolId: "a", schoolYearId: "y", amount: 10 }] : [record] }) };
    }));
    const result = await loadSectionSchoolYear(user, "y");
    expect(requests.sort()).toEqual(["feeTypes", "payments", "payments", "students"]);
    expect(result.students).toEqual([record]); expect(result.payments).toHaveLength(1);
    expect(result.parents).toEqual([]); expect(result.expenses).toEqual([]); expect(result.cashInflows).toEqual([]);
  });
  it("vérifie le profil et l'école du bootstrap serveur", async () => {
    const bootstrap = { users: [user], schools: [{ id: "a", status: "active" }], schoolYears: [{ id: "y", schoolId: "a" }] };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => bootstrap }));
    vi.stubGlobal("fetch", fetcher);
    expect(await loadSectionSchoolBootstrap(user)).toEqual(bootstrap);
    bootstrap.schoolYears[0].schoolId = "b";
    await expect(loadSectionSchoolBootstrap(user)).rejects.toThrow("hors périmètre");
  });
  it("charge toutes les pages sans requête Firestore ni doublon", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ...page, nextCursorId: "class-a" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => page });
    vi.stubGlobal("fetch", fetcher);
    expect(await loadSectionSchoolRecords("classes", user, "a", "y")).toEqual([record]);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ action: "list-section-school-records", kind: "classes", schoolYearId: "y", cursorId: "class-a" });
  });
  it("refuse un périmètre invalide avant toute requête", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(loadSectionSchoolRecords("classes", user, "b", "y")).rejects.toThrow();
    await expect(loadSectionSchoolRecords("students", { ...user, sectionIds: [] }, "a", "y")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ schoolId: "b" }, { schoolYearId: "other" }, { section: "Secondaire" }, { section: undefined }])("refuse une donnée incohérente", async (patch) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...page, items: [{ ...record, ...patch }] }) })));
    await expect(loadSectionSchoolRecords("students", user, "a", "y")).rejects.toThrow("hors périmètre");
  });
  it("ne rend pas de résultat partiel après une erreur ou un curseur répété", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ ...page, nextCursorId: "class-a" }) }));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadSectionSchoolRecords("classes", user, "a", "y")).rejects.toThrow("Pagination");
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    await expect(loadSectionSchoolRecords("classes", user, "a", "y")).rejects.toThrow("refusé");
  });
});
