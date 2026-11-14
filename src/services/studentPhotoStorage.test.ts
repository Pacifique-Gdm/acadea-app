import { describe, expect, it, vi } from "vitest";

const storageCalls = vi.hoisted(() => ({ getBlob: 0 }));
vi.mock("../firebase", () => ({ storage: {} }));
vi.mock("firebase/storage", () => ({
  ref: (_storage: unknown, path: string) => path,
  uploadBytes: vi.fn(), deleteObject: vi.fn(),
  getBlob: vi.fn(async () => { storageCalls.getBlob += 1; return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }); }),
}));

import { dataUrlToBlob, isEmbeddedPhoto, loadStudentPhotoUrl, needsStorageUpload, studentPhotoPathMatches, withPhotoForPdf } from "./studentPhotoStorage";
import { schoolDeletionInventory, deleteSchoolStorage } from "../../api/_lib/schoolDeletion.js";
import { bucketPhotoSigner, withTeacherPhotoUrls } from "../../api/_lib/studentPhotoAccess.js";
import { migrateStudentPhotos } from "../../api/_lib/studentPhotoMigration.js";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const photoPath = `schools/school-a/student-photos/child-a/${uuid}.jpg`;
const embedded = "data:image/jpeg;base64,AQID";

describe("photos d'élèves : navigateur", () => {
  it("n'envoie dans Storage qu'une photo nouvellement choisie, jamais l'ancienne ni une photo déjà rangée", () => {
    expect(needsStorageUpload({ photoUrl: embedded }, "")).toBe(true);
    expect(needsStorageUpload({ photoUrl: embedded }, embedded)).toBe(false);
    expect(needsStorageUpload({ photoUrl: embedded, photoPath }, "")).toBe(false);
    expect(needsStorageUpload({ photoUrl: "" }, embedded)).toBe(false);
  });

  it("reconnaît les photos intégrées et les chemins rattachés à l'école et à l'élève", () => {
    expect(isEmbeddedPhoto(embedded)).toBe(true);
    expect(isEmbeddedPhoto("https://example.test/x.jpg")).toBe(false);
    expect(studentPhotoPathMatches(photoPath, "school-a", "child-a")).toBe(true);
    expect(studentPhotoPathMatches(photoPath, "school-b", "child-a")).toBe(false);
    expect(studentPhotoPathMatches(`schools/school-a/student-photos/child-a/photo.jpg`, "school-a", "child-a")).toBe(false);
  });

  it("convertit une photo intégrée en fichier et refuse un autre format", () => {
    const blob = dataUrlToBlob(embedded);
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBe(3);
    expect(() => dataUrlToBlob("data:text/html;base64,AAAA")).toThrow("Photo invalide");
  });

  it("lit la photo Storage une seule fois, avec l'identité de l'utilisateur", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:photo");
    expect(await loadStudentPhotoUrl(photoPath)).toBe("blob:photo");
    expect(await loadStudentPhotoUrl(photoPath)).toBe("blob:photo");
    expect(storageCalls.getBlob).toBe(1);
  });

  it("PDF : intègre la photo Storage d'abord, sinon garde l'ancienne photo", async () => {
    const reader = vi.fn(async () => new Blob([new Uint8Array([9])], { type: "image/png" }));
    class FakeReader { result = "data:image/png;base64,CQ=="; onload: (() => void) | null = null; onerror: (() => void) | null = null; readAsDataURL() { this.onload?.(); } }
    vi.stubGlobal("FileReader", FakeReader);
    expect((await withPhotoForPdf({ photoPath, photoUrl: embedded }, reader)).photoUrl).toBe("data:image/png;base64,CQ==");
    expect((await withPhotoForPdf({ photoPath, photoUrl: embedded }, async () => { throw new Error("refus"); })).photoUrl).toBe(embedded);
    expect((await withPhotoForPdf({ photoUrl: embedded }, reader)).photoUrl).toBe(embedded);
    vi.unstubAllGlobals();
  });
});

describe("photos d'élèves : serveur", () => {
  it("l'enseignant reçoit une adresse temporaire seulement pour les photos de son école", async () => {
    const sign = vi.fn(async (path: string) => `https://storage.googleapis.com/signed/${path}`);
    const rows = await withTeacherPhotoUrls([
      { id: "child-a", schoolId: "school-a", photoPath },
      { id: "foreign", schoolId: "school-a", photoPath: `schools/school-b/student-photos/x/${uuid}.jpg` },
      { id: "old", schoolId: "school-a", photoUrl: embedded },
    ], "school-a", sign);
    expect(rows[0].photoStorageUrl).toContain(photoPath);
    expect(rows[1]).not.toHaveProperty("photoStorageUrl");
    expect(rows[2]).not.toHaveProperty("photoStorageUrl");
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("le signataire refuse un chemin hors photos d'élèves et limite la durée à 10 minutes", async () => {
    const getSignedUrl = vi.fn(async () => ["https://signed"]);
    const signer = bucketPhotoSigner({ file: () => ({ getSignedUrl }) }, () => 1_000);
    await expect(signer("personnel-photos/x/y.jpg")).rejects.toThrow("invalide");
    await signer(photoPath);
    expect(getSignedUrl).toHaveBeenCalledWith({ version: "v4", action: "read", expires: 1_000 + 10 * 60 * 1000 });
  });

  it("la suppression d'école efface aussi les photos d'élèves rangées sous l'école", async () => {
    expect(schoolDeletionInventory().storagePrefixes).toContain("schools/{schoolId}/");
    const deleted: string[] = [];
    const bucket = { getFiles: async ({ prefix }: { prefix: string }) => [[photoPath, `schools/school-b/student-photos/x/${uuid}.jpg`].filter((name) => name.startsWith(prefix)).map((name) => ({ name, delete: async () => { deleted.push(name); } }))], file: () => ({ delete: async () => undefined }) };
    const db = { collection: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) };
    await deleteSchoolStorage(bucket, db, "school-a");
    expect(deleted).toEqual([photoPath]);
  });
});

describe("migration des photos vers Storage", () => {
  function fixture() {
    const docs = new Map<string, Record<string, unknown>>([
      ["students/child-a", { schoolId: "school-a", photoUrl: embedded }],
      ["students/child-b", { schoolId: "school-a", photoUrl: embedded, photoPath }],
      ["students/child-c", { schoolId: "school-a" }],
      ["students/child-other", { schoolId: "school-b", photoUrl: embedded }],
    ]);
    const saved: Array<{ path: string; bytes: number }> = [];
    const db = {
      collection: () => ({ where: (_f: string, _o: string, value: string) => ({ select: () => ({ get: async () => ({ size: [...docs.values()].filter((row) => row.schoolId === value).length,
        docs: [...docs.entries()].filter(([, row]) => row.schoolId === value).map(([path, row]) => ({ id: path.split("/")[1], data: () => row })) }) }) }) }),
      doc: (path: string) => ({ update: async (value: Record<string, unknown>) => { docs.set(path, { ...docs.get(path), ...value }); } }),
    };
    const bucket = { file: (path: string) => ({ save: async (bytes: Buffer) => { saved.push({ path, bytes: bytes.length }); } }) };
    return { docs, saved, db, bucket };
  }

  it("simulation : compte les photos à copier sans rien écrire", async () => {
    const { db, bucket, saved, docs } = fixture();
    expect(await migrateStudentPhotos({ db, bucket, schoolId: "school-a" })).toMatchObject({ students: 3, photosToCopy: 1, applied: false });
    expect(saved).toEqual([]);
    expect(docs.get("students/child-a")).not.toHaveProperty("photoPath");
  });

  it("refuse d'appliquer sans sauvegarde", async () => {
    const { db, bucket } = fixture();
    await expect(migrateStudentPhotos({ db, bucket, schoolId: "school-a", apply: true })).rejects.toThrow("Sauvegarde");
  });

  it("sauvegarde d'abord, copie dans Storage, garde l'ancienne photo et ne recopie pas une seconde fois", async () => {
    const { db, bucket, saved, docs } = fixture();
    const order: string[] = [];
    const backup = vi.fn(async (content: { photos: Array<{ id: string }> }) => { order.push(`sauvegarde:${content.photos.map((photo) => photo.id).join(",")}`); });
    const result = await migrateStudentPhotos({ db, bucket: { file: (path: string) => ({ save: async (bytes: Buffer) => { order.push("copie"); saved.push({ path, bytes: bytes.length }); } }) }, schoolId: "school-a", apply: true, backup, newId: () => uuid, now: "2026-11-14T12:00:00.000Z" });
    expect(order).toEqual(["sauvegarde:child-a", "copie"]);
    expect(result).toMatchObject({ copied: 1, applied: true });
    expect(saved).toEqual([{ path: photoPath, bytes: 3 }]);
    expect(docs.get("students/child-a")).toMatchObject({ photoUrl: embedded, photoPath, photoMigratedAt: "2026-11-14T12:00:00.000Z" });
    expect(docs.get("students/child-other")).not.toHaveProperty("photoPath");
    expect(await migrateStudentPhotos({ db, bucket, schoolId: "school-a" })).toMatchObject({ photosToCopy: 0 });
  });
});
