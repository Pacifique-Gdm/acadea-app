import { readFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { COORDINATION_LOGO_COLLECTION, stageCoordinationLogoWrite } from "./coordinationLogo.js";
// @ts-expect-error Module JavaScript sans déclaration de types.
import { schoolLogoVersion, stageSchoolLogoWrite } from "./schoolLogo.js";

const LOGO = "data:image/png;base64,QUFBQQ==";
const THUMB = `data:image/webp;base64,${"A".repeat(3000)}`;
const isDelete = (value: unknown) => Boolean(value && typeof value === "object" && "isEqual" in value && (value as { isEqual: (other: unknown) => boolean }).isEqual(FieldValue.delete()));

function recorder() {
  const writes: Array<{ op: string; path: string; data?: Record<string, unknown> }> = [];
  return {
    writes,
    db: { doc: (path: string) => ({ path }) },
    writer: { set: (ref: { path: string }, data: Record<string, unknown>) => writes.push({ op: "set", path: ref.path, data }), delete: (ref: { path: string }) => writes.push({ op: "delete", path: ref.path }) },
  };
}

describe("enregistrement d'un nouveau logo par le serveur", () => {
  it("coordination : logo complet à part, vignette et repère sur la coordination", () => {
    const { db, writer, writes } = recorder();
    const fields = stageCoordinationLogoWrite(db, writer, { coordinationId: "c1", logoUrl: LOGO, logoThumbUrl: THUMB, updatedAt: "t", updatedBy: "u" });
    expect(writes).toEqual([{ op: "set", path: `${COORDINATION_LOGO_COLLECTION}/c1`, data: { coordinationId: "c1", logoUrl: LOGO, logoVersion: schoolLogoVersion(LOGO), updatedAt: "t", updatedBy: "u" } }]);
    expect(isDelete(fields.logoUrl)).toBe(true);
    expect(fields.logoVersion).toBe(schoolLogoVersion(LOGO));
    expect(fields.logoThumbUrl).toBe(THUMB);
  });

  it("coordination : logo retiré, vignette retirée", () => {
    const { db, writer, writes } = recorder();
    const fields = stageCoordinationLogoWrite(db, writer, { coordinationId: "c1", logoUrl: "", logoThumbUrl: "", updatedAt: "t", updatedBy: "u" });
    expect(writes).toEqual([{ op: "delete", path: `${COORDINATION_LOGO_COLLECTION}/c1` }]);
    expect(fields.logoVersion).toBe("");
    expect(isDelete(fields.logoThumbUrl)).toBe(true);
  });

  it("école : la vignette suit le nouveau logo ; une vignette invalide n'est jamais gardée", () => {
    const { db, writer } = recorder();
    expect(stageSchoolLogoWrite(db, writer, { schoolId: "s1", logoUrl: LOGO, logoThumbUrl: THUMB, updatedAt: "t", updatedBy: "u" }).logoThumbUrl).toBe(THUMB);
    expect(isDelete(stageSchoolLogoWrite(db, writer, { schoolId: "s1", logoUrl: LOGO, logoThumbUrl: `data:image/webp;base64,${"A".repeat(9000)}`, updatedAt: "t", updatedBy: "u" }).logoThumbUrl)).toBe(true);
    expect(isDelete(stageSchoolLogoWrite(db, writer, { schoolId: "s1", logoUrl: LOGO, updatedAt: "t", updatedBy: "u" }).logoThumbUrl)).toBe(true);
  });

  it("les paramètres de la coordination rangent le logo à part et ne l'effacent pas s'il n'est pas envoyé", () => {
    const api = readFileSync("api/manage-coordination.js", "utf8");
    expect(api).toContain("const logoChanged = input.logoUrl !== undefined;");
    expect(api).toContain("stageCoordinationLogoWrite(db, batch,");
    expect(api).not.toContain("logoUrl: text(input.logoUrl),");
  });
});
