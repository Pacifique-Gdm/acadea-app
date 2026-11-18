import { describe, expect, it } from "vitest";
import {
  assertStagingProject,
  buildFixtureSchool,
  FIXTURE_NAME_PREFIX,
  FIXTURE_PREFIX,
  FIXTURE_TAG,
  isFixtureDocument,
  MAX_FIXTURE_SCHOOLS,
  parseSchoolTotal,
} from "../scripts/superAdminPerf/fixtureSafety.mjs";

describe("écoles fictives du Super administrateur", () => {
  it("refuse tout autre projet que le staging", () => {
    expect(() => assertStagingProject("acadea-production")).toThrow(/Refusé/);
    expect(() => assertStagingProject("")).toThrow(/Refusé/);
    expect(() => assertStagingProject("acadea-staging ")).toThrow(/Refusé/);
    expect(() => assertStagingProject("acadea-staging")).not.toThrow();
  });

  it("limite le nombre d'écoles demandé", () => {
    expect(parseSchoolTotal("500")).toBe(500);
    expect(parseSchoolTotal(String(MAX_FIXTURE_SCHOOLS))).toBe(MAX_FIXTURE_SCHOOLS);
    for (const value of ["0", "-3", "1.5", "abc", String(MAX_FIXTURE_SCHOOLS + 1)]) expect(() => parseSchoolTotal(value)).toThrow();
  });

  it("marque clairement chaque document créé", () => {
    const documents = buildFixtureSchool(7, "2026-11-18T00:00:00.000Z");
    expect(documents.map((item) => item.collection)).toEqual(["schools", "schoolYears", "users"]);
    for (const item of documents) {
      expect(item.id.startsWith(FIXTURE_PREFIX)).toBe(true);
      expect(item.data.fixture).toBe(FIXTURE_TAG);
      expect(item.data.id).toBe(item.id);
      expect(isFixtureDocument(item.collection, item.id, item.data)).toBe(true);
    }
    expect(documents[0].data.name.startsWith(FIXTURE_NAME_PREFIX)).toBe(true);
    expect(documents[2].data.email.endsWith("@example.invalid")).toBe(true);
    expect(buildFixtureSchool(7, "x")[0].id).toBe(documents[0].id);
  });

  it("n'efface jamais un vrai document", () => {
    expect(isFixtureDocument("schools", "school-210fc308", { fixture: FIXTURE_TAG })).toBe(false);
    expect(isFixtureDocument("schools", `${FIXTURE_PREFIX}school-00001`, { name: "Vraie école" })).toBe(false);
    expect(isFixtureDocument("payments", `${FIXTURE_PREFIX}school-00001`, { fixture: FIXTURE_TAG })).toBe(false);
    expect(isFixtureDocument("schools", `${FIXTURE_PREFIX}school-00001`, { fixture: FIXTURE_TAG, id: "school-210fc308" })).toBe(false);
  });
});
