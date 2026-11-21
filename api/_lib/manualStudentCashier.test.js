// Lot C : le caissier crée et modifie un élève comme le secrétaire ; chaque ajout ou modification est noté (qui, quand, avant / après).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { saveManualStudent } from "./manualStudentSave.js";
import { studentChanges } from "./studentChangeLog.js";

const cashier = { uid: "cashier-a", role: "cashier", schoolId: "school-a" };
const base = { id: `student-${"c".repeat(32)}`, schoolId: "school-a", schoolYearId: "year-a", classId: "class-a", className: "1ère Primaire",
  nom: "KABILA", postnom: "Mbuyi", prenom: "Anne", sexe: "F", birthDate: "2015-04-05", status: "ACTIVE" };

function fixture(extra = []) {
  const rows = new Map([
    ["users/cashier-a", { role: "cashier", schoolId: "school-a", active: true, name: "Caissier A" }],
    ["users/teacher-a", { role: "teacher", schoolId: "school-a", active: true }],
    ["schools/school-a", { status: "active", activeSchoolYearId: "year-a" }],
    ["schoolYears/year-a", { name: "2026-2027", schoolId: "school-a", status: "active" }],
    ["classes/class-a", { name: "1ère Primaire", schoolId: "school-a", schoolYearId: "year-a", active: true }],
    ["classes/class-b", { name: "2ème Primaire", schoolId: "school-a", schoolYearId: "year-a", active: true }],
    ...extra,
  ]);
  const snapshot = (path) => ({ id: path.split("/").at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const db = {
    doc: (path) => ({ path }),
    collection: (collection) => {
      const filters = [];
      const query = { where(field, op, value) { filters.push([field, op, value]); return query; }, select() { return query; }, collection, filters };
      return query;
    },
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (ref) => ref.path ? snapshot(ref.path) : { docs: [...rows.keys()].filter((path) => path.startsWith(`${ref.collection}/`))
          .filter((path) => ref.filters.every(([field, op, value]) => { const v = rows.get(path)?.[field]; return op === ">=" ? v >= value : op === "<" ? v < value : v === value; })).map(snapshot) },
        set: (ref, data) => writes.push([ref.path, data]), create: (ref, data) => writes.push([ref.path, data]), delete: (ref) => writes.push([ref.path, null]),
      });
      for (const [path, data] of writes) { if (data) rows.set(path, data); else rows.delete(path); }
      return result;
    },
  };
  return { db, rows };
}
const logs = (rows) => [...rows].filter(([path]) => path.startsWith("studentChangeLogs/")).map(([, data]) => data);

describe("lot C : fiche élève enregistrée par le caissier", () => {
  it("le caissier crée un élève (refusé avant le lot C) et la création est notée", async () => {
    const { db, rows } = fixture();
    const { student } = await saveManualStudent({ db, caller: cashier, body: { intent: "create", clientRequestId: "a".repeat(32), student: base } });
    expect(student.matricule).toBe("ACD-26-0001");
    const [log] = logs(rows);
    expect(log).toMatchObject({ action: "create", actorId: "cashier-a", actorRole: "cashier", actorName: "Caissier A", studentId: base.id, schoolId: "school-a" });
    expect(log.after).toMatchObject({ nom: "KABILA", className: "1ère Primaire" });
    expect(log.before).toEqual({});
    expect([...rows.keys()].some((path) => path.startsWith("auditLogs/audit_stu_"))).toBe(true);
  });

  it("le caissier modifie la fiche : seuls les champs changés sont notés, avec l'avant et l'après", async () => {
    const { db, rows } = fixture([[`students/${base.id}`, { ...base, matricule: "ACD-26-0001" }]]);
    await saveManualStudent({ db, caller: cashier, body: { intent: "update", student: { ...base, phone: "0990000000", classId: "class-b", className: "2ème Primaire" } } });
    const [log] = logs(rows);
    expect(log.action).toBe("update");
    expect(log.before).toEqual({ className: "1ère Primaire", classId: "class-a", phone: "" });
    expect(log.after).toEqual({ className: "2ème Primaire", classId: "class-b", phone: "0990000000" });
  });

  it("une fiche enregistrée sans changement n'ajoute aucune ligne", async () => {
    const { db, rows } = fixture([[`students/${base.id}`, { ...base, matricule: "ACD-26-0001", address: "", phone: "" }]]);
    await saveManualStudent({ db, caller: cashier, body: { intent: "update", student: { ...base, address: "", phone: "" } } });
    expect(logs(rows)).toEqual([]);
  });

  it("un enseignant reste refusé", async () => {
    const { db } = fixture();
    await expect(saveManualStudent({ db, caller: { uid: "teacher-a", role: "teacher", schoolId: "school-a" }, body: { intent: "create", student: base } }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it("la photo n'est jamais copiée dans l'historique", () => {
    const changes = studentChanges({ ...base, photoUrl: "data:image/png;base64,AAAA" }, { ...base, photoPath: "schools/school-a/student-photos/x/y.jpg" });
    expect(changes.after.photo).toBe("modifiée");
    expect(JSON.stringify(changes)).not.toContain("base64");
  });
});

describe("lot C : autres actions de la fiche ouvertes au caissier, et seulement elles", () => {
  const provision = readFileSync(new URL("../provision-school-account.js", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const storage = readFileSync(new URL("../../storage.rules", import.meta.url), "utf8");
  it("compte parent, lien et retrait du lien : caissier accepté", () => {
    expect(provision.match(/allowSecretary: true, allowCashier: true/g)).toHaveLength(2);
    expect(provision).toContain('allowSecretary: role === "parent", allowCashier: role === "parent"');
  });
  it("suppression d'un parent : toujours réservée à l'administrateur et au secrétaire", () => {
    expect(provision).toContain("await assertAuthorizedCaller({ db, caller, schoolId, allowSecretary: true });\n".replace(/\n/g, provision.includes("\r\n") ? "\r\n" : "\n"));
  });
  it("règles : historique lu par l'administrateur seul, jamais écrit depuis l'écran ; photo et options ouvertes au caissier", () => {
    expect(rules).toContain("match /studentChangeLogs/{logId} {\n      allow read: if superAdmin() || (schoolAdmin() && sameTenantResource());\n      allow create, update, delete: if false;");
    expect(rules).toContain("return (secretary() || activeCashier())");
    expect(storage).toContain('role() in ["school_admin", "secretary", "cashier"] && tenantSchoolId() == schoolId;');
  });
});
