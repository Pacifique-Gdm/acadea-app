import { describe, expect, it, vi } from "vitest";

const deletion = vi.hoisted(() => ({ deleteSchoolCompletely: vi.fn() }));
vi.mock("../api/_lib/schoolDeletion.js", () => deletion);

import {
  assertStagingFixtureTag,
  fixtureLeftovers,
  isFixtureDocumentOf,
  isRetiredFixtureSchool,
  purgeStagingFixture,
  stagingRestBucket,
} from "../scripts/stagingFixturePurge.mjs";

const tag = "e2e-social-0123456789abcdef0123456789abcdef";
type Row = Record<string, unknown>;

/** Petite base en mémoire : collections racines, filtres « == », lots d'effacement. */
function fakeDb(collections: Record<string, Record<string, Row>>) {
  const ref = (name: string, id: string) => ({ id, path: `${name}/${id}`, parent: { id: name }, collection: () => ({ select: () => ({ get: async () => ({ docs: [] }) }) }) });
  const query = (name: string, filters: [string, string, unknown][] = []) => {
    const api = {
      where: (field: string, op: string, value: unknown) => query(name, [...filters, [field, op, value]]),
      select: () => api,
      limit: () => api,
      get: async () => {
        const docs = Object.entries(collections[name] ?? {})
          .filter(([, data]) => filters.every(([field, op, value]) => (op === "in" ? (value as unknown[]).includes(data[field]) : data[field] === value)))
          .map(([id, data]) => ({ id, ref: ref(name, id), data: () => data }));
        return { docs, size: docs.length };
      },
    };
    return api;
  };
  return {
    collections,
    collection: (name: string) => query(name),
    listCollections: async () => Object.keys(collections).map((name) => ({ id: name, ...query(name) })),
    collectionGroup: () => ({ get: async () => ({ docs: [] }) }),
    batch: () => {
      const paths: string[] = [];
      return { delete: (r: { path: string }) => paths.push(r.path), commit: async () => { for (const path of paths) { const [name, id] = path.split("/"); delete collections[name]?.[id]; } } };
    },
  };
}

describe("effacement des écoles d'essai du staging", () => {
  it("refuse tout autre projet que le staging et toute marque douteuse", () => {
    expect(() => assertStagingFixtureTag("acadea-production", tag)).toThrow(/Refusé/);
    expect(() => assertStagingFixtureTag("acadea-staging", "school-210fc308")).toThrow(/marque/);
    expect(() => assertStagingFixtureTag("acadea-staging", tag)).not.toThrow();
  });

  it("ne reconnaît que les documents portant la marque exacte et l'identifiant préfixé", () => {
    expect(isFixtureDocumentOf(tag, `${tag}-a`, { fixtureId: tag, id: `${tag}-a` })).toBe(true);
    expect(isFixtureDocumentOf(tag, "school-210fc308", { fixtureId: tag })).toBe(false);
    expect(isFixtureDocumentOf(tag, `${tag}-a`, { fixtureId: "e2e-social-ffffffffffffffffffffffffffffffff" })).toBe(false);
    expect(isFixtureDocumentOf(tag, `${tag}-a`, { fixtureId: tag, id: "autre" })).toBe(false);
  });

  it("ne vise que les écoles d'essai retirées, jamais une école active", () => {
    const retired = { fixtureId: tag, id: `${tag}-a`, status: "inactive", active: false, fixtureLifecycle: "retired" };
    expect(isRetiredFixtureSchool(`${tag}-a`, retired)).toBe(true);
    expect(isRetiredFixtureSchool(`${tag}-a`, { ...retired, status: "active" })).toBe(false);
    expect(isRetiredFixtureSchool("ecole-staging", { status: "inactive", active: false, fixtureLifecycle: "retired" })).toBe(false);
  });

  it("efface l'école, ses documents, ses signaux et ses comptes, sans toucher au reste", async () => {
    deletion.deleteSchoolCompletely.mockImplementation(async ({ db, schoolId }) => {
      delete db.collections.schools[schoolId];
      return { firestore: { deleted: 0 }, auth: { deleted: 0 } };
    });
    const db = fakeDb({
      schools: { [`${tag}-a`]: { fixtureId: tag, id: `${tag}-a` }, "school-reelle": { name: "Vraie école" } },
      users: { [`${tag}-admin`]: { fixtureId: tag, id: `${tag}-admin`, schoolId: `${tag}-a` }, "vrai-admin": { schoolId: "school-reelle" } },
      feeAllocationForecastSignals: { abc: { schoolId: `${tag}-a` }, def: { schoolId: "school-reelle" } },
      coordinations: { [`${tag}-coord`]: { fixtureId: tag, id: `${tag}-coord` }, "vraie-coord": { name: "Vraie" } },
    });
    const auth = { getUser: vi.fn(async (uid: string) => ({ uid, email: `${uid}@example.invalid` })), deleteUser: vi.fn(async () => undefined) };
    const wait = vi.fn(async () => undefined);
    const report = await purgeStagingFixture({ db, auth, bucket: {}, projectId: "acadea-staging", tag, wait });
    expect(report.schools).toBe(1);
    expect(auth.deleteUser).toHaveBeenCalledWith(`${tag}-admin`);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(Object.keys(db.collections.schools)).toEqual(["school-reelle"]);
    expect(Object.keys(db.collections.users)).toEqual(["vrai-admin"]);
    expect(Object.keys(db.collections.feeAllocationForecastSignals)).toEqual(["def"]);
    expect(Object.keys(db.collections.coordinations)).toEqual(["vraie-coord"]);
    expect(await fixtureLeftovers(db, tag, [`${tag}-a`])).toEqual([]);
  });

  it("refuse d'effacer un compte qui n'a pas une adresse fictive", async () => {
    deletion.deleteSchoolCompletely.mockResolvedValue({ firestore: { deleted: 0 }, auth: { deleted: 0 } });
    const db = fakeDb({ schools: {}, users: { [`${tag}-admin`]: { fixtureId: tag, id: `${tag}-admin` } } });
    const auth = { getUser: vi.fn(async () => ({ email: "personne@vraie-ecole.cd" })), deleteUser: vi.fn() };
    await expect(purgeStagingFixture({ db, auth, bucket: {}, projectId: "acadea-staging", tag, wait: async () => undefined })).rejects.toThrow(/Compte étranger/);
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  it("le stockage passe par l'API officielle avec le jeton de la recette", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      calls.push(`${init?.method ?? "GET"} ${url} ${init?.headers?.Authorization}`);
      return { ok: true, status: 200, json: async () => ({ items: [{ name: "valves/x/a.pdf" }] }) };
    });
    const bucket = stagingRestBucket("acadea-staging.firebasestorage.app", async () => ({ access_token: "jeton" }), { fetchImpl });
    const [files] = await bucket.getFiles({ prefix: "valves/x/" });
    await files[0].delete({ ignoreNotFound: true });
    expect(calls[0]).toContain("GET https://storage.googleapis.com/storage/v1/b/acadea-staging.firebasestorage.app/o?prefix=valves%2Fx%2F Bearer jeton");
    expect(calls[1]).toContain("DELETE https://storage.googleapis.com/storage/v1/b/acadea-staging.firebasestorage.app/o/valves%2Fx%2Fa.pdf Bearer jeton");
  });
});
