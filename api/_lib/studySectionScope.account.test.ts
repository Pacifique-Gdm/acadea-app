import { describe, expect, it } from "vitest";
import { teacherInSections, teacherSections, teacherUserIdsInSections } from "./studySectionScope.js";

// Lot R2 : dans l'application, la section d'un enseignant est enregistrée sur son COMPTE (`users`),
// pas sur sa fiche (`teachers`). Le serveur doit la lire au même endroit que l'écran.
type Value = Record<string, unknown>;
const scope = { schoolId: "s", schoolYearId: "y" };

function fakeDb(collections: Record<string, Value[]>) {
  const query = (name: string, filters: Array<[string, unknown]> = []): unknown => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
    get: async () => ({ docs: (collections[name] ?? []).filter((row) => filters.every(([field, value]) => row[field] === value)).map((row) => ({ id: String(row.id), data: () => row })) }),
  });
  return { collection: (name: string) => query(name) };
}

describe("lot R2 : section de l'enseignant lue sur son compte", () => {
  it("prend la section du compte, sinon celle de la fiche", () => {
    expect(teacherSections({ section: "Primaire" }, { sectionIds: ["Secondaire"] })).toEqual(["Secondaire"]);
    expect(teacherSections({ section: "Primaire" }, {})).toEqual(["Primaire"]);
    expect(teacherSections({}, undefined)).toEqual([]);
  });

  it("une fiche sans section n'ouvre plus l'enseignant à toutes les sections si son compte en a une", () => {
    expect(teacherInSections({ sections: ["Secondaire"], teacherId: "t", teacher: {}, teacherUser: { sectionIds: ["Primaire"] } })).toBe(false);
    expect(teacherInSections({ sections: ["Primaire"], teacherId: "t", teacher: {}, teacherUser: { section: "Primaire" } })).toBe(true);
    expect(teacherInSections({ sections: ["Secondaire"], teacherId: "t", teacher: {}, teacherUser: {} })).toBe(true);
  });

  it("l'Historique ne retient que les comptes enseignants des sections, d'après leur compte", async () => {
    const db = fakeDb({
      teachers: [{ id: "tp", ...scope, userId: "up" }, { id: "ts", ...scope, userId: "us" }, { id: "tn", ...scope, userId: "un" }],
      users: [
        { id: "up", schoolId: "s", role: "teacher", sectionIds: ["Primaire"] },
        { id: "us", schoolId: "s", role: "teacher", section: "Secondaire" },
        { id: "un", schoolId: "s", role: "teacher" },
      ],
      pedagogicalAssignments: [],
      classes: [],
    });
    expect([...await teacherUserIdsInSections({ db, sections: ["Secondaire"], ...scope })].sort()).toEqual(["un", "us"]);
  });
});
