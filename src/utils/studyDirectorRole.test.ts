import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const menu = readFileSync(new URL("../modules/menu/MenuModule.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/provision-school-account.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

describe("rôle Directeur des études", () => {
  it("est proposé par le formulaire Administrateur", () => {
    expect(menu).toContain('<option value="study_director">Directeur des études</option>');
    expect(menu).toContain("temporaryPasswordAfterPhoneChange");
    expect(menu).toContain("provisionSchoolUser");
  });

  it("est provisionné avec le profil et les claims existants", () => {
    expect(api).toContain('"study_director"');
    expect(api).toContain("setCustomUserClaims(authUser.uid, { role, schoolId })");
    expect(api).toContain("const userRef = db.doc(`users/${authUser.uid}`)");
    expect(api).toContain("userRef.set(schoolUser)");
  });

  it("n'obtient que les lectures tenant nécessaires à la phase 1", () => {
    expect(rules).toContain('role() == "study_director"');
    expect(rules).toContain("studyDirector() && schoolId == tenantSchoolId()");
    expect(rules).toContain("studyDirector() && resource.data.schoolId == tenantSchoolId()");
  });
});
