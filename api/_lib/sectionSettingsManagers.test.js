import { describe, expect, it } from "vitest";
import { eligibleManagerSections, loadSectionSettingsManagers, prepareManagerCleanup, toAuthorityManagers, sectionNeedsManager, setSectionSettingsManager, validManagers } from "./sectionSettingsManagers.js";

// Lot R6 : « Responsable des réglages de la section ».
const S = "school-r6";
const base = () => ({
  "users/admin": { role: "school_admin", schoolId: S, status: "active" },
  "users/prefect": { role: "study_director", studyFunction: "prefect_of_studies", schoolId: S, sectionIds: ["Secondaire"], name: "Jean", status: "active" },
  "users/director": { role: "study_director", schoolId: S, sectionIds: ["Secondaire", "CTEB"], name: "Marie", status: "active" },
  "users/primary": { role: "study_director", studyFunction: "primary_director", schoolId: S, sectionIds: ["Primaire"], name: "Paul", status: "active" },
  "users/other-school": { role: "study_director", studyFunction: "prefect_of_studies", schoolId: "x", sectionIds: ["CTEB"], status: "active" },
});

function fakeDb(rows) {
  const writes = [];
  const snap = (path) => ({ exists: Boolean(rows[path]), data: () => rows[path], id: path.split("/")[1] });
  const query = (filters) => ({
    where: (field, _op, value) => query([...filters, [field, value]]),
    get: async () => ({ docs: Object.keys(rows).filter((path) => path.startsWith("users/") && filters.every(([field, value]) => rows[path][field] === value)).map(snap) }),
  });
  const ref = (path) => ({ path, get: async () => snap(path) });
  const writer = {
    get: async (target) => target.get(),
    set: (target, data) => { writes.push(["set", target.path, data]); rows[target.path] = data; },
    create: (target, data) => writes.push(["create", target.path, data]),
  };
  return {
    writes, rows,
    doc: ref,
    collection: (name) => name === "users" ? query([]) : { doc: (id) => ref(`${name}/${id}`) },
    runTransaction: async (fn) => fn(writer),
  };
}
const admin = { uid: "admin", role: "school_admin", schoolId: S };
const call = (db, body, caller = admin) => setSectionSettingsManager({ db, caller, body: { schoolId: S, ...body } });
const users = (rows) => Object.entries(rows).filter(([path]) => path.startsWith("users/")).map(([path, data]) => ({ ...data, id: path.split("/")[1] }));

describe("lot R6 : condition d'affichage de la case", () => {
  it("seulement une section secondaire avec un Préfet d'études ET un Directeur des études", () => {
    const list = users(base());
    expect(sectionNeedsManager(list, S, "Secondaire")).toBe(true);
    expect(sectionNeedsManager(list, S, "CTEB")).toBe(false); // seulement un Directeur (le Préfet de l'autre école ne compte pas)
    expect(sectionNeedsManager(list, S, "Primaire")).toBe(false);
    expect(eligibleManagerSections(list, S, list.find((user) => user.id === "director"))).toEqual(["Secondaire"]);
    expect(eligibleManagerSections(list, S, list.find((user) => user.id === "primary"))).toEqual([]);
  });
  it("un compte archivé ou sans section ne compte pas", () => {
    const rows = base();
    rows["users/prefect"].status = "inactive";
    expect(sectionNeedsManager(users(rows), S, "Secondaire")).toBe(false);
    const rows2 = base();
    rows2["users/prefect"] = { ...rows2["users/prefect"], sectionIds: [] };
    expect(sectionNeedsManager(users(rows2), S, "Secondaire")).toBe(false);
    const rows3 = base();
    rows3["users/prefect"] = { ...rows3["users/prefect"], sectionIds: undefined, section: "Secondaire" };
    expect(sectionNeedsManager(users(rows3), S, "Secondaire")).toBe(true);
  });
  it("une désignation devenue invalide n'est plus prise en compte", () => {
    const rows = base();
    rows["users/prefect"].active = false;
    expect(validManagers({ Secondaire: { userId: "director" } }, users(rows), S)).toEqual({});
    expect(validManagers({ Secondaire: { userId: "director" } }, users(base()), S)).toEqual({ Secondaire: { userId: "director" } });
  });
});

describe("lot R6 : désignation par l'administrateur", () => {
  it("l'administrateur coche la case ; un seul responsable par section", async () => {
    const db = fakeDb(base());
    await expect(call(db, { section: "Secondaire", userId: "prefect", enabled: true })).resolves.toMatchObject({ managers: { Secondaire: { userId: "prefect" } } });
    expect(db.rows[`sectionSettingsManagers/${S}`].managers.Secondaire.userId).toBe("prefect");
    expect(db.writes.some(([kind, path]) => kind === "create" && path.startsWith("auditLogs/"))).toBe(true);
  });
  it("remplacer exige le responsable actuel vu à l'écran (« Remplacer X par Y ? »)", async () => {
    const db = fakeDb(base());
    await call(db, { section: "Secondaire", userId: "prefect", enabled: true });
    await expect(call(db, { section: "Secondaire", userId: "director", enabled: true })).rejects.toMatchObject({ statusCode: 409, code: "conflict" });
    await expect(call(db, { section: "Secondaire", userId: "director", enabled: true, expectedUserId: "prefect" })).resolves.toMatchObject({ managers: { Secondaire: { userId: "director" } } });
    expect(Object.keys(db.rows[`sectionSettingsManagers/${S}`].managers)).toEqual(["Secondaire"]);
  });
  it("décocher redonne le fonctionnement automatique ; décocher un autre ne change rien", async () => {
    const db = fakeDb(base());
    await call(db, { section: "Secondaire", userId: "prefect", enabled: true });
    await expect(call(db, { section: "Secondaire", userId: "director", enabled: false })).resolves.toMatchObject({ managers: { Secondaire: { userId: "prefect" } } });
    await expect(call(db, { section: "Secondaire", userId: "prefect", enabled: false })).resolves.toEqual({ managers: {} });
    expect(db.rows[`sectionSettingsManagers/${S}`].managers).toEqual({});
  });
  it("refuse si la condition n'est pas remplie ou la personne n'a pas la section", async () => {
    const db = fakeDb(base());
    await expect(call(db, { section: "CTEB", userId: "director", enabled: true })).rejects.toMatchObject({ statusCode: 409, code: "failed-precondition" });
    await expect(call(db, { section: "Secondaire", userId: "primary", enabled: true })).rejects.toMatchObject({ statusCode: 409 });
    await expect(call(db, { section: "Primaire", userId: "primary", enabled: true })).rejects.toMatchObject({ statusCode: 400 });
    expect(db.writes).toEqual([]);
  });
  it("réservé à l'administrateur actif de l'école", async () => {
    const db = fakeDb(base());
    await expect(call(db, { section: "Secondaire", userId: "prefect", enabled: true }, { uid: "prefect", role: "study_director", schoolId: S })).rejects.toMatchObject({ statusCode: 403 });
    await expect(call(db, { section: "Secondaire", userId: "prefect", enabled: true }, { uid: "admin", role: "school_admin", schoolId: "x" })).rejects.toMatchObject({ statusCode: 403 });
    db.rows["users/admin"].status = "inactive";
    await expect(call(db, { section: "Secondaire", userId: "prefect", enabled: true })).rejects.toMatchObject({ statusCode: 403 });
    expect(db.writes).toEqual([]);
  });
});

describe("lot R6 : retrait automatique quand un compte change", () => {
  it("le responsable archivé ou qui perd la section n'est plus désigné", async () => {
    const db = fakeDb(base());
    await call(db, { section: "Secondaire", userId: "prefect", enabled: true });
    const cleanup = await prepareManagerCleanup({ reader: { get: (ref) => ref.get() }, db, schoolId: S, changedUser: { ...db.rows["users/director"], id: "director", status: "inactive", active: false } });
    expect(cleanup).toBeTypeOf("function");
    cleanup({ set: (ref, data) => { db.rows[ref.path] = data; } }, "now", "admin");
    expect(db.rows[`sectionSettingsManagers/${S}`].managers).toEqual({});
  });
  it("aucune écriture si la désignation reste valable ou s'il n'y en a pas", async () => {
    const db = fakeDb(base());
    expect(await prepareManagerCleanup({ reader: { get: (ref) => ref.get() }, db, schoolId: S, changedUser: { ...db.rows["users/director"], id: "director", sectionIds: [] } })).toBeNull();
    await call(db, { section: "Secondaire", userId: "prefect", enabled: true });
    expect(await prepareManagerCleanup({ reader: { get: (ref) => ref.get() }, db, schoolId: S, changedUser: { ...db.rows["users/director"], id: "director", name: "Marie K." } })).toBeNull();
  });
});

describe("lot R6 : lecture pour le périmètre de réglage", () => {
  it("convertit le document en « section → compte désigné »", async () => {
    expect(toAuthorityManagers({ Secondaire: { userId: "prefect" }, CTEB: {}, Primaire: { userId: "x" } })).toEqual({ Secondaire: "prefect" });
    const db = fakeDb(base());
    expect(await loadSectionSettingsManagers(db, S)).toEqual({});
    await call(db, { section: "Secondaire", userId: "prefect", enabled: true });
    expect(await loadSectionSettingsManagers(db, S)).toEqual({ Secondaire: "prefect" });
    db.rows[`sectionSettingsManagers/${S}`].schoolId = "x";
    expect(await loadSectionSettingsManagers(db, S)).toEqual({});
  });
});
