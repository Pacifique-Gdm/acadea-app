import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertSectionsUnchangedByStudyDirector, assertStudyDirectorSections, managePersonnel } from "../../api/provision-school-account.js";

// Lot A : seul l'administrateur de l'école modifie les sections d'un compte existant.
const refused = (run: () => void) => { try { run(); return 0; } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1; } };

function fakeFirebase(docs: Record<string, Record<string, unknown>>) {
  const writes: Array<{ kind: string; path: string; data: Record<string, unknown> }> = [];
  const ref = (path: string) => ({ id: path.split("/").pop(), path, get: async () => ({ exists: path in docs, data: () => docs[path] }) });
  const db = {
    doc: ref,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (run: (transaction: unknown) => Promise<unknown>) => run({
      get: (target: { get: () => Promise<unknown> }) => target.get(),
      set: (target: { path: string }, data: Record<string, unknown>) => writes.push({ kind: "set", path: target.path, data }),
      update: (target: { path: string }, data: Record<string, unknown>) => writes.push({ kind: "update", path: target.path, data }),
      create: (target: { path: string }, data: Record<string, unknown>) => writes.push({ kind: "create", path: target.path, data }),
    }),
  };
  const auth = { getUser: async () => ({ displayName: "Ancien nom", email: "ancien@ecole.cd" }), updateUser: async () => undefined };
  return { db, auth, writes };
}

const baseDocs = () => ({
  "schools/s1": { schoolType: "mixte" },
  "users/admin1": { role: "school_admin", schoolId: "s1", status: "active" },
  "users/dir1": { role: "study_director", schoolId: "s1", status: "active", sectionIds: ["Primaire", "Secondaire"] },
  "users/t1": { role: "teacher", schoolId: "s1", status: "active", sectionIds: ["Primaire"], section: "Primaire", name: "Ancien nom", email: "ancien@ecole.cd" },
});
const body = (sectionIds: string[]) => ({ schoolId: "s1", personnelId: "t1", name: "Nouveau nom", phone: "0990000000", email: "ancien@ecole.cd", section: sectionIds[0] ?? null, sectionIds, profile: {} });

describe("Lot A — sections d'un enseignant existant", () => {
  it("laisse la Direction des études créer un enseignant dans ses sections", () => {
    expect(refused(() => assertStudyDirectorSections({ sectionIds: ["Primaire"] }, ["Primaire"]))).toBe(0);
  });

  it("refuse tout changement de sections, accepte les mêmes sections dans un autre ordre ou écrites autrement", () => {
    expect(refused(() => assertSectionsUnchangedByStudyDirector(["Primaire"], ["Primaire"]))).toBe(0);
    expect(refused(() => assertSectionsUnchangedByStudyDirector(["Secondaire", "Primaire"], ["primaire", "Secondaire"]))).toBe(0);
    expect(refused(() => assertSectionsUnchangedByStudyDirector(["Primaire", "Secondaire"], ["Primaire"]))).toBe(403);
    expect(refused(() => assertSectionsUnchangedByStudyDirector([], ["Primaire"]))).toBe(403);
    expect(refused(() => assertSectionsUnchangedByStudyDirector(["Primaire"], []))).toBe(403);
  });

  it("refuse à la Direction des études de changer les sections d'un enseignant, avec un message clair, sans rien écrire", async () => {
    const { db, auth, writes } = fakeFirebase(baseDocs());
    await expect(managePersonnel({ auth, db, caller: { uid: "dir1", role: "study_director", schoolId: "s1" }, body: body(["Primaire", "Secondaire"]), action: "update-personnel" }))
      .rejects.toMatchObject({ statusCode: 403, message: "Seul l'administrateur de l'école peut modifier les sections d'un enseignant existant." });
    expect(writes).toHaveLength(0);
  });

  it("laisse la Direction des études modifier le reste de la fiche si les sections ne changent pas", async () => {
    const { db, auth, writes } = fakeFirebase(baseDocs());
    const result = await managePersonnel({ auth, db, caller: { uid: "dir1", role: "study_director", schoolId: "s1" }, body: body(["Primaire"]), action: "update-personnel" });
    expect(result.user).toMatchObject({ name: "Nouveau nom", sectionIds: ["Primaire"] });
    expect(writes.find((write) => write.path === "users/t1")?.data).toMatchObject({ name: "Nouveau nom", sectionIds: ["Primaire"] });
  });

  it("laisse l'administrateur de l'école changer les sections d'un enseignant", async () => {
    const { db, auth, writes } = fakeFirebase(baseDocs());
    const result = await managePersonnel({ auth, db, caller: { uid: "admin1", role: "school_admin", schoolId: "s1" }, body: body(["Primaire", "Secondaire"]), action: "update-personnel" });
    expect(result.user.sectionIds).toEqual(["Primaire", "Secondaire"]);
    expect(writes.find((write) => write.path === "users/t1")?.data).toMatchObject({ section: "Primaire", sectionIds: ["Primaire", "Secondaire"] });
  });

  it("désactive le champ Sections de la fiche pour la Direction des études", () => {
    const source = readFileSync("src/modules/menu/PersonnelDrawerContent.tsx", "utf8");
    const field = source.slice(source.indexOf('<MultiSelectDropdown label="Sections"'));
    expect(field.slice(0, field.indexOf("/>"))).toContain('disabled={user.role === "study_director"}');
  });
});
