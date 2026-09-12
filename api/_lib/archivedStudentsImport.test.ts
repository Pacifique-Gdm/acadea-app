import { describe, expect, it } from "vitest";
import { mappedAssignmentScope } from "./archivedStudentsImport.js";

describe("import annuel des portées pédagogiques", () => {
  it("remappe les options canoniques et recalcule la clé de groupe", () => {
    const classIds = new Map([["old-class", "new-class"]]);
    expect(mappedAssignmentScope({
      courseScope: "common",
      targetOptionIds: ["old-class::scientifique", "old-class::commerciale"],
      studentGroupKey: "stale",
    }, classIds)).toEqual({
      courseScope: "common",
      targetOptionIds: ["new-class::commerciale", "new-class::scientifique"],
      studentGroupKey: "common--new-class%3A%3Acommerciale--new-class%3A%3Ascientifique",
    });
  });

  it("laisse les affectations historiques sans nouvelle portée", () => {
    expect(mappedAssignmentScope({}, new Map())).toEqual({});
  });
});
