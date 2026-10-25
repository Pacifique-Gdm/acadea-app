import { describe, expect, it } from "vitest";
import { assertCorrespondenceFileAccess, assertCorrespondenceFilePath, decodeCorrespondenceFile } from "./secretaryCorrespondenceFile.js";

const identity = { uid: "secretary-a", role: "secretary", schoolId: "school-a" };
const profile = { role: "secretary", schoolId: "school-a", status: "active", active: true };
const school = { status: "active" };
const correspondence = { schoolId: "school-a", status: "received" };

describe("accès serveur aux pièces jointes", () => {
  it("permet au Secrétaire actif de consulter un courrier actif ou archivé de son école", () => {
    expect(assertCorrespondenceFileAccess(identity, profile, school, correspondence, "download")).toBe("school-a");
    expect(assertCorrespondenceFileAccess(identity, profile, school, { ...correspondence, status: "archived" }, "download")).toBe("school-a");
  });

  it("refuse les rôles non autorisés et les anciens claims après transfert", () => {
    for (const role of ["parent", "teacher", "cashier"]) {
      expect(() => assertCorrespondenceFileAccess({ ...identity, role }, profile, school, correspondence, "download")).toThrow();
    }
    expect(() => assertCorrespondenceFileAccess(identity, { ...profile, schoolId: "school-b" }, school, correspondence, "download")).toThrow();
    expect(() => assertCorrespondenceFileAccess({ ...identity, schoolId: "school-b" }, profile, school, correspondence, "download")).toThrow();
    expect(() => assertCorrespondenceFileAccess(identity, { ...profile, status: "inactive" }, school, correspondence, "download")).toThrow();
  });

  it("refuse une école suspendue ou un courrier d'une autre école", () => {
    expect(() => assertCorrespondenceFileAccess(identity, profile, { status: "suspended" }, correspondence, "download")).toThrow();
    expect(() => assertCorrespondenceFileAccess(identity, profile, school, { ...correspondence, schoolId: "school-b" }, "download")).toThrow();
    expect(() => assertCorrespondenceFileAccess(identity, profile, school, undefined, "download")).toThrow();
  });

  it("interdit les écritures sur un courrier archivé", () => {
    expect(() => assertCorrespondenceFileAccess(identity, profile, school, { ...correspondence, status: "archived" }, "upload")).toThrow();
    expect(() => assertCorrespondenceFileAccess(identity, profile, school, { ...correspondence, status: "archived" }, "purge")).toThrow();
  });

  it("ne lit ou ne supprime qu'un fichier situé sous son propre courrier", () => {
    const path = "schools/school-a/correspondences/corr-a/document.pdf";
    expect(assertCorrespondenceFilePath(path, "school-a", "corr-a")).toBe(path);
    expect(() => assertCorrespondenceFilePath("schools/school-b/correspondences/corr-a/document.pdf", "school-a", "corr-a")).toThrow();
    expect(() => assertCorrespondenceFilePath("schools/school-a/correspondences/corr-b/document.pdf", "school-a", "corr-a")).toThrow();
    expect(() => assertCorrespondenceFilePath("schools/school-a/correspondences/corr-a/../secret.pdf", "school-a", "corr-a")).toThrow();
  });

  it("valide les octets, la taille et le type du téléversement", () => {
    expect(decodeCorrespondenceFile({ name: "document.pdf", contentType: "application/pdf", dataBase64: "AQI=" }).bytes).toEqual(Buffer.from([1, 2]));
    expect(() => decodeCorrespondenceFile({ name: "document.pdf", contentType: "text/html", dataBase64: "AQI=" })).toThrow();
    expect(() => decodeCorrespondenceFile({ name: "../document.pdf", contentType: "application/pdf", dataBase64: "AQI=" })).toThrow();
    expect(() => decodeCorrespondenceFile({ name: "document.pdf", contentType: "application/pdf", dataBase64: "invalid!" })).toThrow();
    expect(() => decodeCorrespondenceFile({ name: "document.pdf", contentType: "application/pdf", dataBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") })).toThrow();
  });
});
