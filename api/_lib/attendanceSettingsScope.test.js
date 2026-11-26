import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attendanceSettingsScope, classRuleSection, executeAttendanceSettings } from "./attendanceSettingsScope.js";

// Base en mémoire : doc().get(), collection().where(==)…get() et runTransaction (get/set).
function memoryDb(values) {
  const snap = (path) => ({ exists: values.has(path), id: path.split("/").at(-1), data: () => structuredClone(values.get(path)) });
  const query = (name, filters) => ({
    where: (key, _op, value) => query(name, [...filters, [key, value]]),
    get: async () => ({ docs: [...values].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/").length === 2 && filters.every(([key, value]) => data[key] === value)).map(([path]) => snap(path)) }),
  });
  const db = {
    doc: (path) => ({ path, get: async () => snap(path) }),
    collection: (name) => query(name, []),
    writes: [],
    runTransaction: async (work) => {
      const pending = [];
      const result = await work({ get: (target) => target.get(), set: (ref, data) => pending.push([ref.path, data]) });
      for (const [path, data] of pending) { values.set(path, data); db.writes.push(path); }
      return result;
    },
  };
  return db;
}

const school = "school-a", year = "year-a", settingsPath = "attendanceSettings/attendance-settings__school-a__year-a";
const existing = {
  id: "attendance-settings__school-a__year-a", schoolId: school, schoolYearId: year,
  schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  defaultSchedule: { monday: { lateAfter: "07:30" } },
  sectionSchedule: { Primaire: { monday: { lateAfter: "07:15" } }, Secondaire: { monday: { lateAfter: "07:45" } } },
  classSchedule: { "1ère Primaire": { monday: { lateAfter: "07:10" } }, "1ère Humanité__Latin": { monday: { lateAfter: "07:50" } } },
  sectionSchoolDays: { Secondaire: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] },
  updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "other",
};
function seeded({ otherDirector = true, schoolLevels = ["Primaire", "Secondaire"], settings = existing } = {}) {
  const v = new Map();
  v.set(`schools/${school}`, { status: "active", educationLevels: schoolLevels });
  v.set(`schoolYears/${year}`, { schoolId: school, status: "active" });
  v.set("users/primary", { role: "discipline_director", schoolId: school, sectionIds: ["Primaire"] });
  v.set("users/both", { role: "discipline_director", schoolId: school, sectionIds: ["Primaire", "Secondaire"] });
  v.set("users/secondary", { role: "discipline_director", schoolId: school, sectionIds: ["Secondaire"], status: otherDirector ? "active" : "inactive" });
  v.set("users/other", { role: "discipline_director", schoolId: school, name: "Marie Ilunga" });
  if (!otherDirector) { v.set("users/other", { role: "discipline_director", schoolId: school, active: false }); v.delete("users/both"); }
  v.set("users/foreign", { role: "discipline_director", schoolId: "school-b" });
  if (settings) v.set(settingsPath, settings);
  return v;
}
const call = (values, uid, body) => {
  const db = memoryDb(values);
  return { db, run: executeAttendanceSettings({ db, caller: { uid, role: "discipline_director", schoolId: school }, body: { schoolId: school, ...body } }) };
};
const proposal = {
  schoolDays: ["monday"],
  defaultSchedule: { monday: { lateAfter: "09:00" } },
  sectionSchedule: { Primaire: { monday: { lateAfter: "07:20" } }, Secondaire: { monday: { lateAfter: "09:00" } } },
  classSchedule: { "1ère Primaire": { monday: { lateAfter: "07:05" } }, "1ère Humanité__Latin": { monday: { lateAfter: "09:00" } }, "2ème Primaire": { tuesday: { lateAfter: "07:00" } } },
  sectionSchoolDays: { Primaire: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"], Secondaire: ["monday"] },
};

describe("lot R3 : périmètre des réglages de présence (serveur)", () => {
  it("limité seulement si les sections ne couvrent pas l'école ET qu'un autre Directeur actif existe", () => {
    const school2 = { educationLevels: ["Primaire", "Secondaire"] };
    expect(attendanceSettingsScope({ actor: { sectionIds: ["Primaire"] }, school: school2, otherActiveDirectors: 1 })).toEqual({ limited: true, sections: ["Primaire"] });
    expect(attendanceSettingsScope({ actor: { sectionIds: ["Primaire"] }, school: school2, otherActiveDirectors: 0 }).limited).toBe(false);
    expect(attendanceSettingsScope({ actor: { sectionIds: ["Primaire", "Secondaire"] }, school: school2, otherActiveDirectors: 3 }).limited).toBe(false);
    expect(attendanceSettingsScope({ actor: { section: "Primaire" }, school: { educationLevels: ["Primaire"] }, otherActiveDirectors: 2 }).limited).toBe(false);
    expect(attendanceSettingsScope({ actor: {}, school: school2, otherActiveDirectors: 2 })).toEqual({ limited: false, sections: [] });
    expect(classRuleSection("1ère Humanité__Latin")).toBe("Secondaire");
    expect(classRuleSection("3ème Primaire")).toBe("Primaire");
  });

  it("l'action de lecture compte seulement les autres Directeurs actifs de la même école", async () => {
    await expect(call(seeded(), "primary", { action: "attendance-settings-scope" }).run).resolves.toEqual({ limited: true, sections: ["Primaire"] });
    await expect(call(seeded({ otherDirector: false }), "primary", { action: "attendance-settings-scope" }).run).resolves.toEqual({ limited: false, sections: ["Primaire"] });
    await expect(call(seeded(), "both", { action: "attendance-settings-scope" }).run).resolves.toEqual({ limited: false, sections: ["Primaire", "Secondaire"] });
  });

  it("refuse un autre rôle, une autre école ou un compte inactif", async () => {
    const values = seeded();
    await expect(executeAttendanceSettings({ db: memoryDb(values), caller: { uid: "primary", role: "study_director", schoolId: school }, body: { action: "attendance-settings-scope", schoolId: school } })).rejects.toMatchObject({ status: 403 });
    await expect(executeAttendanceSettings({ db: memoryDb(values), caller: { uid: "foreign", role: "discipline_director", schoolId: "school-b" }, body: { action: "attendance-settings-scope", schoolId: school } })).rejects.toMatchObject({ status: 403 });
    values.set("users/primary", { ...values.get("users/primary"), status: "inactive" });
    await expect(call(values, "primary", { action: "attendance-settings-scope" }).run).rejects.toMatchObject({ status: 403 });
  });

  it("compte limité : ne remplace que SES sections et les classes de SES sections", async () => {
    const values = seeded();
    const { run } = call(values, "primary", { action: "attendance-settings-save", schoolYearId: year, settings: proposal, expectedUpdatedAt: existing.updatedAt });
    const { settings, limited } = await run;
    expect(limited).toBe(true);
    const saved = values.get(settingsPath);
    expect(saved).toEqual(settings);
    expect(saved.schoolDays).toEqual(existing.schoolDays);
    expect(saved.defaultSchedule).toEqual(existing.defaultSchedule);
    expect(saved.sectionSchedule).toEqual({ Primaire: { monday: { lateAfter: "07:20" } }, Secondaire: { monday: { lateAfter: "07:45" } } });
    expect(saved.sectionSchoolDays).toEqual({ Secondaire: existing.sectionSchoolDays.Secondaire, Primaire: proposal.sectionSchoolDays.Primaire });
    expect(saved.classSchedule).toEqual({ "1ère Primaire": { monday: { lateAfter: "07:05" } }, "1ère Humanité__Latin": { monday: { lateAfter: "07:50" } }, "2ème Primaire": { tuesday: { lateAfter: "07:00" } } });
    expect(saved.updatedBy).toBe("primary");
  });

  it("compte limité : retirer une règle de SA classe la supprime, sans toucher aux autres sections", async () => {
    const values = seeded();
    await call(values, "primary", { action: "attendance-settings-save", schoolYearId: year, settings: { sectionSchedule: {}, classSchedule: {}, sectionSchoolDays: {} }, expectedUpdatedAt: existing.updatedAt }).run;
    const saved = values.get(settingsPath);
    expect(saved.sectionSchedule).toEqual({ Secondaire: existing.sectionSchedule.Secondaire });
    expect(saved.classSchedule).toEqual({ "1ère Humanité__Latin": existing.classSchedule["1ère Humanité__Latin"] });
    expect(saved.sectionSchoolDays).toEqual(existing.sectionSchoolDays);
  });

  it("compte avec sections non limité (seul Directeur ou toutes les sections) : enregistrement complet comme aujourd'hui", async () => {
    for (const [values, uid] of [[seeded({ otherDirector: false }), "primary"], [seeded(), "both"]]) {
      const { settings, limited } = await call(values, uid, { action: "attendance-settings-save", schoolYearId: year, settings: proposal, expectedUpdatedAt: existing.updatedAt }).run;
      expect(limited).toBe(false);
      expect(settings).toMatchObject({ schoolDays: ["monday"], defaultSchedule: proposal.defaultSchedule, sectionSchedule: proposal.sectionSchedule, classSchedule: proposal.classSchedule, sectionSchoolDays: proposal.sectionSchoolDays, updatedBy: uid });
    }
  });

  it("crée le document s'il n'existe pas encore (compte limité : ses sections seulement)", async () => {
    const values = seeded({ settings: null });
    await call(values, "primary", { action: "attendance-settings-save", schoolYearId: year, settings: proposal, expectedUpdatedAt: null }).run;
    const saved = values.get(settingsPath);
    expect(Object.keys(saved).sort()).toEqual(["classSchedule", "id", "schoolId", "schoolYearId", "sectionSchedule", "sectionSchoolDays", "updatedAt", "updatedBy"]);
    expect(saved.sectionSchedule).toEqual({ Primaire: proposal.sectionSchedule.Primaire });
  });

  it("le premier gagne : « Déjà modifié par [nom, fonction] » si le document a changé", async () => {
    const values = seeded();
    const { db, run } = call(values, "primary", { action: "attendance-settings-save", schoolYearId: year, settings: proposal, expectedUpdatedAt: "2026-10-01T00:00:00.000Z" });
    await expect(run).rejects.toMatchObject({ status: 409, code: "settings-conflict", message: "Déjà modifié par Marie Ilunga, Directeur de discipline, rechargez avec la flèche ronde de l'en-tête." });
    expect(db.writes).toEqual([]);
  });

  it("refuse un compte sans section (il écrit directement), une année inactive et des valeurs invalides", async () => {
    const values = seeded();
    await expect(call(values, "other", { action: "attendance-settings-save", schoolYearId: year, settings: proposal, expectedUpdatedAt: existing.updatedAt }).run).rejects.toMatchObject({ status: 403 });
    values.set(`schoolYears/${year}`, { schoolId: school, status: "archived" });
    await expect(call(values, "primary", { action: "attendance-settings-save", schoolYearId: year, settings: proposal, expectedUpdatedAt: existing.updatedAt }).run).rejects.toMatchObject({ status: 403 });
    const fresh = seeded();
    for (const settings of [{ sectionSchedule: { Primaire: { monday: { lateAfter: "25:00" } } } }, { sectionSchoolDays: { Primaire: ["sunday"] } }, { sectionSchedule: { Inconnue: {} } }, { classSchedule: { "a/b": {} } }]) {
      await expect(call(fresh, "primary", { action: "attendance-settings-save", schoolYearId: year, settings, expectedUpdatedAt: existing.updatedAt }).run).rejects.toMatchObject({ status: 400 });
    }
  });

  it("passe par le fichier api existant, avec contrôle du compte et limite de fréquence", () => {
    const handler = readFileSync("api/manage-teacher-grading.js", "utf8");
    const branch = handler.slice(handler.indexOf('action === "attendance-settings-scope"'), handler.indexOf("const execute ="));
    expect(branch).toContain("await requireActiveApiUser(db, caller);");
    expect(branch.indexOf("requireActiveApiUser")).toBeLessThan(branch.indexOf("enforceApiRateLimit"));
    expect(branch).toContain("executeAttendanceSettings({ db, caller, body })");
  });
});
