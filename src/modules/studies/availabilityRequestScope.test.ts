import { describe, expect, it } from "vitest";
import { scopeAvailabilityRequests } from "./availabilityRequestScope";

// Lot R2 : la liste des demandes d'indisponibilité suit les sections du compte Direction des études.
const items = [{ id: "1", teacherId: "prim" }, { id: "2", teacherId: "sec" }, { id: "3", teacherId: "none" }, { id: "4", teacherId: "sec-affecte" }, { id: "5", teacherId: "inconnu" }];
const teachers = [
  { id: "prim", sectionIds: ["Primaire" as const] },
  { id: "sec", sectionIds: ["Secondaire" as const] },
  { id: "none" },
  { id: "sec-affecte", section: "Secondaire" as const },
];
const assignments = [{ teacherId: "sec-affecte", classId: "c-prim", active: true }, { teacherId: "sec", classId: "c-prim", active: false }];
const classes = [{ id: "c-prim" }];

describe("R2 — demandes visibles", () => {
  it("compte sans section : toutes les demandes, comme avant", () => {
    expect(scopeAvailabilityRequests({ user: {}, items, teachers, assignments, classes }).map((item) => item.id)).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("compte avec sections : enseignants de ses sections, sans section ou affectés à ses classes", () => {
    expect(scopeAvailabilityRequests({ user: { sectionIds: ["Primaire"] }, items, teachers, assignments, classes }).map((item) => item.id)).toEqual(["1", "3", "4"]);
  });
  it("lit l'ancienne section du compte", () => {
    expect(scopeAvailabilityRequests({ user: { section: "Secondaire" }, items, teachers }).map((item) => item.id)).toEqual(["2", "3", "4"]);
  });
});
