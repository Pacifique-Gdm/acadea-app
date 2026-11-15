import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Module API Vercel implémenté en JavaScript côté serveur.
import { removeLegacyStudentPhotos, restoreLegacyStudentPhotos } from "../../api/_lib/studentPhotoLegacyCleanup.js";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const pathFor = (id: string) => `schools/school-a/student-photos/${id}/${uuid}.jpg`;
const embedded = "data:image/jpeg;base64,AQID"; // 3 octets
const DELETE = Symbol("delete");
type Doc = Record<string, unknown>;

function fixture(sizes: Record<string, number> = {}) {
  const docs = new Map<string, Doc>([
    ["students/ok", { schoolId: "school-a", photoUrl: embedded, photoPath: pathFor("ok") }],
    ["students/no-storage", { schoolId: "school-a", photoUrl: embedded }],
    ["students/foreign", { schoolId: "school-a", photoUrl: embedded, photoPath: pathFor("other") }],
    ["students/missing", { schoolId: "school-a", photoUrl: embedded, photoPath: pathFor("missing") }],
    ["students/new-photo", { schoolId: "school-a", photoUrl: embedded, photoPath: pathFor("new-photo") }],
    ["students/already", { schoolId: "school-a", photoPath: pathFor("already") }],
    ["students/other-school", { schoolId: "school-b", photoUrl: embedded, photoPath: "schools/school-b/student-photos/other-school/x.jpg" }],
  ]);
  const objects: Record<string, number> = { [pathFor("ok")]: 3, [pathFor("foreign")]: 3, [pathFor("new-photo")]: 9, ...sizes };
  const statObject = vi.fn(async (path: string) => (path in objects ? { size: String(objects[path]) } : undefined));
  const applyWrite = (path: string, value: Doc) => {
    const next: Doc = { ...docs.get(path) };
    for (const [key, field] of Object.entries(value)) { if (field === DELETE) delete next[key]; else next[key] = field; }
    docs.set(path, next);
  };
  const db = {
    collection: () => ({ where: (_f: string, _o: string, schoolId: string) => ({ select: () => ({ get: async () => {
      const rows = [...docs].filter(([, data]) => data.schoolId === schoolId).map(([path, data]) => ({ id: path.split("/")[1], data: () => data }));
      return { size: rows.length, docs: rows };
    } }) }) }),
    doc: (path: string) => ({ path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) }),
    runTransaction: async <T>(work: (transaction: { get: (ref: { path: string }) => Promise<unknown>; update: (ref: { path: string }, value: Doc) => void }) => Promise<T>) => {
      const writes: Array<() => void> = [];
      const result = await work({ get: async (ref) => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }), update: (ref, value) => writes.push(() => applyWrite(ref.path, value)) });
      writes.forEach((write) => write());
      return result;
    },
  };
  return { docs, db, statObject, deleteField: () => DELETE };
}

describe("retrait des anciennes photos intégrées (lot 9, étape 2)", () => {
  it("simulation : n'écrit rien et ne retient que les photos dont la copie Storage est identique", async () => {
    const { db, statObject, deleteField, docs } = fixture();
    const before = JSON.stringify([...docs]);
    const result = await removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a" });
    expect(result).toMatchObject({ students: 6, photosToRemove: 1, applied: false, kept: { noStoragePhoto: 1, foreignPath: 1, missingInStorage: 1, sizeMismatch: 1, unreadable: 0 } });
    expect(JSON.stringify([...docs])).toBe(before);
  });

  it("refuse une lecture incomplète des fiches et n'écrit rien", async () => {
    const { db, statObject, deleteField, docs } = fixture();
    const backup = vi.fn();
    await expect(removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a", apply: true, backup, countStudents: async () => 7 })).rejects.toThrow("Lecture incomplète");
    expect(backup).not.toHaveBeenCalled();
    expect(docs.get("students/ok")).toHaveProperty("photoUrl", embedded);
    expect(await removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a", countStudents: async () => 6 })).toMatchObject({ photosToRemove: 1 });
  });

  it("refuse d'appliquer sans sauvegarde", async () => {
    const { db, statObject, deleteField } = fixture();
    await expect(removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a", apply: true })).rejects.toThrow("Sauvegarde");
  });

  it("sauvegarde d'abord, puis retire seulement l'ancienne photo vérifiée en gardant la photo Storage", async () => {
    const { db, statObject, deleteField, docs } = fixture();
    const order: string[] = [];
    const backup = vi.fn(async (content: { photos: Array<{ id: string; photoUrl: string }> }) => { order.push(`sauvegarde:${content.photos.map((p) => `${p.id}=${p.photoUrl}`).join(",")}`); });
    const result = await removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a", apply: true, backup });
    expect(order).toEqual([`sauvegarde:ok=${embedded}`]);
    expect(result).toMatchObject({ removed: 1, changed: 0, applied: true });
    expect(docs.get("students/ok")).toEqual({ schoolId: "school-a", photoPath: pathFor("ok") });
    for (const id of ["no-storage", "foreign", "missing", "new-photo"]) expect(docs.get(`students/${id}`)).toHaveProperty("photoUrl", embedded);
    expect(docs.get("students/other-school")).toHaveProperty("photoUrl", embedded);
    expect(await removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a" })).toMatchObject({ photosToRemove: 0 });
  });

  it("ne retire rien si la fiche a changé entre la vérification et le retrait", async () => {
    const { db, statObject, deleteField, docs } = fixture();
    const backup = vi.fn(async () => { docs.set("students/ok", { ...docs.get("students/ok"), photoUrl: "data:image/jpeg;base64,BBBB" }); });
    const result = await removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a", apply: true, backup });
    expect(result).toMatchObject({ removed: 0, changed: 1 });
    expect(docs.get("students/ok")).toHaveProperty("photoUrl", "data:image/jpeg;base64,BBBB");
  });
});

describe("restauration des anciennes photos depuis la sauvegarde", () => {
  it("retrait puis restauration : la fiche redevient exactement comme avant", async () => {
    const { db, statObject, deleteField, docs } = fixture();
    const original = structuredClone(docs.get("students/ok"));
    let saved: unknown;
    await removeLegacyStudentPhotos({ db, statObject, deleteField, schoolId: "school-a", apply: true, backup: async (content: unknown) => { saved = structuredClone(content); } });
    expect(docs.get("students/ok")).not.toHaveProperty("photoUrl");
    const before = JSON.stringify([...docs]);
    expect(await restoreLegacyStudentPhotos({ db, backupContent: saved, schoolId: "school-a" })).toMatchObject({ photos: 1, toRestore: 1, restored: 0, applied: false });
    expect(JSON.stringify([...docs])).toBe(before);
    expect(await restoreLegacyStudentPhotos({ db, backupContent: saved, schoolId: "school-a", apply: true })).toMatchObject({ restored: 1 });
    expect(docs.get("students/ok")).toEqual(original);
    // Relancée : rien à refaire.
    expect(await restoreLegacyStudentPhotos({ db, backupContent: saved, schoolId: "school-a", apply: true })).toMatchObject({ restored: 0, alreadyPresent: 1 });
  });

  it("n'écrase jamais une photo plus récente et refuse une sauvegarde d'une autre école", async () => {
    const { db, docs } = fixture();
    const backupContent = { kind: "legacy-photo-removal", schoolId: "school-a", photos: [
      { id: "already", photoPath: pathFor("autre-photo"), photoUrl: embedded },
      { id: "inconnu", photoPath: pathFor("inconnu"), photoUrl: embedded },
      { id: "ok", photoPath: pathFor("ok"), photoUrl: "pas une photo" },
    ] };
    const result = await restoreLegacyStudentPhotos({ db, backupContent, schoolId: "school-a", apply: true });
    expect(result).toMatchObject({ photoChanged: 1, missingStudent: 1, invalid: 1, restored: 0 });
    expect(docs.get("students/already")).not.toHaveProperty("photoUrl");
    await expect(restoreLegacyStudentPhotos({ db, backupContent, schoolId: "school-b" })).rejects.toThrow("autre école");
    await expect(restoreLegacyStudentPhotos({ db, backupContent: { ...backupContent, kind: "autre" }, schoolId: "school-a" })).rejects.toThrow("Sauvegarde invalide");
  });
});
