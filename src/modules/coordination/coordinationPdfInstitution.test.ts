import { describe, expect, it } from "vitest";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";

describe("identité PDF Coordination", () => {
  it("utilise la Coordination et jamais le logo de l'école filtrée", () => {
    const institution = coordinationPdfInstitution({ id: "coord-a", name: "Coordination X", code: "CX", status: "active", logoUrl: "coord-logo", address: "Coord addr", phone: "1", email: "coord@example.test" }, { id: "school-a", name: "Saint Joseph", logoUrl: "school-logo", address: "school", phone: "2", email: "school@example.test", activeSchoolYearId: "year", status: "active", subscriptionPlan: "Starter", subscriptionAmount: 0 });
    expect(institution.name).toBe("Coordination X");
    expect(institution.logoUrl).toBe("coord-logo");
    expect(institution.logoUrl).not.toBe("school-logo");
  });
});
