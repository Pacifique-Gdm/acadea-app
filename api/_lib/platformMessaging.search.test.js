import { beforeEach, describe, expect, it } from "vitest";
import { parseRecipientSearch, resetRecipientCaches, RECIPIENT_PAGE_SIZE, searchPlatformRecipients } from "./platformMessaging.js";
import { schoolSearchEntry } from "./schoolSearchIndex.js";

/** Petite base en mémoire : filtres « == » et « in », lecture par chemin, et compte des documents lus. */
function fakeDb(collections) {
  const stats = { reads: 0, queries: [] };
  const passes = (row, [field, operator, value]) => (operator === "in" ? value.includes(row[field]) : row[field] === value);
  const query = (name, filters = []) => ({
    where: (field, operator, value) => {
      if (operator === "in" && filters.some(([, op]) => op === "in") && value.length * filters.find(([, op]) => op === "in")[2].length > 30) throw new Error("Plus de 30 combinaisons");
      return query(name, [...filters, [field, operator, value]]);
    },
    get: async () => {
      stats.queries.push({ name, filters });
      const rows = (collections[name] ?? []).filter((row) => filters.every((filter) => passes(row, filter)));
      stats.reads += rows.length;
      return { docs: rows.map((row) => ({ id: row.id, data: () => row })) };
    },
  });
  const docRef = (path) => ({ path, id: path.split("/")[1] });
  return {
    stats,
    collection: (name) => query(name),
    doc: docRef,
    getAll: async (...refs) => refs.map((ref) => {
      stats.reads += 1;
      const [name, id] = ref.path.split("/");
      const row = (collections[name] ?? []).find((item) => item.id === id);
      return { id, exists: Boolean(row), data: () => row };
    }),
  };
}

function platform(schoolCount) {
  const schools = Array.from({ length: schoolCount }, (_, index) => {
    const number = String(index + 1).padStart(4, "0");
    return { id: `school-${number}`, name: `${index % 2 ? "Institut" : "Complexe"} Lumbula ${number}`, status: "active", address: "Kinshasa" };
  });
  const users = [
    ...schools.map((school, index) => ({ id: `admin-${index}`, name: `Admin ${index}`, role: index % 7 ? "school_admin" : "admin", schoolId: school.id, status: "active" })),
    ...schools.map((school, index) => ({ id: `teacher-${index}`, name: `Enseignant ${index}`, role: "teacher", schoolId: school.id, status: "active" })),
    { id: "admin-inactive", name: "Ancien admin", role: "school_admin", schoolId: "school-0001", status: "inactive" },
    { id: "coord-1", name: "Marie Kabila", role: "coordination_admin", coordinationId: "c-1", status: "active" },
    { id: "coord-2", name: "Jean Tshala", role: "coordination_admin", coordinationId: "c-2", status: "active" },
    { id: "sub-1", name: "Paul Mbuyi", role: "sub_coordination_admin", coordinationId: "c-1", status: "active" },
  ];
  const coordinations = [{ id: "c-1", name: "Coordination Kasaï" }, { id: "c-2", name: "Coordination Lomami" }];
  const entries = schools.map((school) => ({ id: school.id, ...schoolSearchEntry(school) }));
  return { collections: { users, coordinations }, entries };
}

describe("lot SA-6 : destinataires du Super administrateur cherchés page par page", () => {
  beforeEach(() => resetRecipientCaches());

  it("administrateurs d'école : seuls ceux des 25 écoles de la page sont lus (jamais tous les comptes)", async () => {
    const { collections, entries } = platform(400);
    const db = fakeDb(collections);
    const result = await searchPlatformRecipients(db, { role: "school_admin" }, { schoolEntries: async () => entries });
    expect(result.unit).toBe("schools");
    expect(result.total).toBe(400);
    expect(result.recipients).toHaveLength(RECIPIENT_PAGE_SIZE);
    expect(result.recipients[0]).toMatchObject({ role: "school_admin", place: "Complexe Lumbula 0001" });

    // 25 administrateurs actifs + 1 inactif (lu puis écarté), en 2 requêtes (15 + 10 écoles), aucun enseignant.
    expect(db.stats.reads).toBe(26);
    expect(db.stats.queries).toHaveLength(2);
    expect(db.stats.queries.every((item) => item.filters.some(([field, op]) => field === "schoolId" && op === "in"))).toBe(true);
  });

  it("cherche l'école par son nom ; page suivante ; compte inactif écarté", async () => {
    const { collections, entries } = platform(400);
    const db = fakeDb(collections);
    const found = await searchPlatformRecipients(db, { role: "school_admin", q: "institut lumbula 0002" }, { schoolEntries: async () => entries });
    expect(found.total).toBe(1);
    expect(found.recipients.map((row) => row.name)).toEqual(["Admin 1"]);
    const second = await searchPlatformRecipients(db, { role: "school_admin", q: "", page: "1" }, { schoolEntries: async () => entries });
    expect(second.page).toBe(1);
    expect(second.recipients[0].place).toBe("Complexe Lumbula 0051");
    const first = await searchPlatformRecipients(db, { role: "school_admin", q: "0001" }, { schoolEntries: async () => entries });
    expect(first.recipients.map((row) => row.uid)).toEqual(["admin-0"]);
  });

  it("une école sans administrateur actif est signalée au lieu de disparaître", async () => {
    const { collections, entries } = platform(3);
    collections.users = collections.users.filter((row) => row.id !== "admin-2");
    const result = await searchPlatformRecipients(fakeDb(collections), { role: "school_admin", q: "0003" }, { schoolEntries: async () => entries });
    expect(result.recipients).toEqual([]);
    expect(result.emptySchools).toEqual([{ id: "school-0003", name: "Complexe Lumbula 0003" }]);
  });

  it("coordinations : recherche par nom de la personne ou de la coordination, gardée 60 s", async () => {
    const { collections, entries } = platform(5);
    const db = fakeDb(collections);
    const all = await searchPlatformRecipients(db, { role: "coordination_admin" }, { schoolEntries: async () => entries, now: 1_000 });
    expect(all.recipients.map((row) => [row.name, row.place])).toEqual([["Jean Tshala", "Coordination Lomami"], ["Marie Kabila", "Coordination Kasaï"]]);
    const readsAfterFirst = db.stats.reads;
    const byPlace = await searchPlatformRecipients(db, { role: "coordination_admin", q: "kasai" }, { schoolEntries: async () => entries, now: 20_000 });
    expect(byPlace.recipients.map((row) => row.uid)).toEqual(["coord-1"]);
    expect(db.stats.reads).toBe(readsAfterFirst);
    const sub = await searchPlatformRecipients(db, { role: "sub_coordination_admin", q: "mbuyi" }, { schoolEntries: async () => entries, now: 20_000 });
    expect(sub.recipients).toEqual([expect.objectContaining({ uid: "sub-1", role: "sub_coordination_admin", place: "Coordination Kasaï" })]);
  });

  it("liste de recherche des écoles absente : recherche des administrateurs par leur nom, sans panne", async () => {
    const { collections } = platform(30);
    const result = await searchPlatformRecipients(fakeDb(collections), { role: "school_admin", q: "admin 12" }, { schoolEntries: async () => null });
    expect(result.unit).toBe("recipients");
    expect(result.recipients.map((row) => row.uid)).toEqual(["admin-12"]);
  });

  it("paramètres invalides ramenés à des valeurs sûres", () => {
    expect(parseRecipientSearch({ role: "parent", page: "-3", q: 12 })).toEqual({ role: "coordination_admin", query: "", page: 0 });
    expect(parseRecipientSearch({ role: ["school_admin"], page: "2", q: "x".repeat(300) })).toMatchObject({ role: "school_admin", page: 2 });
  });
});
