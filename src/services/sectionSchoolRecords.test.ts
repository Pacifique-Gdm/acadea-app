import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "fictitious-test-token" }));
import { loadSectionSchoolRecords } from "./sectionSchoolRecords";
const user = { id: "actor", role: "primary_admin", schoolId: "a", status: "active", sectionIds: ["Primaire"] } as AppUser;
const record = { id: "class-a", schoolId: "a", schoolYearId: "y", section: "Primaire" };
const page = { schoolId: "a", schoolYearId: "y", items: [record], nextCursorId: null };
afterEach(() => vi.unstubAllGlobals());
describe("transport des lectures scolaires bornées", () => {
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
