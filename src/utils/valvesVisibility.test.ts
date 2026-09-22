import { describe, expect, it } from "vitest";
import type { School } from "../types";
import { buildValveVisibilityChoices } from "./valves";

const school = (id: string, educationLevels: string[]): School => ({
  id,
  name: id,
  address: "",
  phone: "",
  email: "",
  educationLevels,
  activeSchoolYearId: `${id}-year`,
  status: "active",
  subscriptionPlan: "Starter",
  subscriptionAmount: 0,
});

describe("visibilité Valves bornée aux sections de l'école", () => {
  it("propose seulement les sections actives avec les portées générales", () => {
    expect(buildValveVisibilityChoices(school("school-a", ["Maternelle", "Primaire"]))).toEqual([
      "all_parents",
      "Maternelle",
      "Primaire",
      "class",
    ]);
  });

  it("réagit au cochage et décochage des sections", () => {
    expect(buildValveVisibilityChoices(school("school-a", ["Primaire", "Secondaire"]))).toContain("Secondaire");
    expect(buildValveVisibilityChoices(school("school-a", ["Primaire"]))).not.toContain("Secondaire");
  });

  it("préserve seulement la visibilité inactive d'une publication existante en modification", () => {
    expect(buildValveVisibilityChoices(school("school-a", ["Primaire"]), "Secondaire")).toContain("Secondaire");
    expect(buildValveVisibilityChoices(school("school-a", ["Primaire"]))).not.toContain("Secondaire");
  });

  it("isole deux écoles", () => {
    expect(buildValveVisibilityChoices(school("school-a", ["Primaire"]))).not.toEqual(
      buildValveVisibilityChoices(school("school-b", ["CTEB"])),
    );
  });
});
