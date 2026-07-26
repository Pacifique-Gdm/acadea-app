import { describe, expect, it } from "vitest";
import type { AppUser } from "../types";
import { canEnterRoute, validateSchoolAdmin } from "../services/auth";
import { ADMIN_REMOVAL_CONFIRMATION, canConfirmAdminRemoval, markAdminRemoved } from "./adminRemoval";

describe("retrait logique d'un administrateur", () => {
  it("accepte uniquement la phrase de confirmation exacte", () => {
    expect(canConfirmAdminRemoval("")).toBe(false);
    expect(canConfirmAdminRemoval("supprimer administrateur")).toBe(false);
    expect(canConfirmAdminRemoval("SUPPRIMER")).toBe(false);
    expect(canConfirmAdminRemoval(`${ADMIN_REMOVAL_CONFIRMATION} `)).toBe(false);
    expect(canConfirmAdminRemoval(ADMIN_REMOVAL_CONFIRMATION)).toBe(true);
  });

  it("desactive le profil sans supprimer son identite ni son rattachement historique", () => {
    const admin: AppUser = {
      id: "admin-1", name: "Admin Test", email: "admin@example.test", role: "school_admin",
      schoolId: "school-1", activeSchoolYearId: "year-1", status: "active",
    };
    expect(markAdminRemoved(admin, "2026-07-26T10:00:00.000Z", "super-1")).toEqual({
      ...admin,
      status: "inactive",
      removedAt: "2026-07-26T10:00:00.000Z",
      removedBy: "super-1",
    });
    expect(admin.status).toBe("active");
  });

  it("refuse les routes ecole a un administrateur retire", () => {
    const removedAdmin = {
      id: "admin-1", role: "school_admin", schoolId: "school-1", status: "inactive",
    } as AppUser;
    expect(canEnterRoute(removedAdmin, "/dashboard")).toBe(false);
    expect(validateSchoolAdmin(removedAdmin)).toBe(false);
  });
});
