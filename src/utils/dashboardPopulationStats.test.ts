import { describe, expect, it } from "vitest";
import type { AppUser, ParentProfile } from "../types";
import { activeDashboardPersonnelCounts, uniqueActiveParentCount } from "./dashboardPopulationStats";

describe("dashboardPopulationStats", () => {
  it("déduplique les parents actifs par UID canonique", () => {
    const parents = [
      { id: "parent-a", userId: "uid-a", status: "active" },
      { id: "parent-a-legacy", userId: "uid-a", status: "active" },
      { id: "parent-b", userId: "uid-b", status: "inactive" },
    ] as ParentProfile[];
    expect(uniqueActiveParentCount(parents)).toBe(1);
  });

  it("compte uniquement le personnel actif de la bonne école et des bons rôles", () => {
    const users = [
      { id: "a1", schoolId: "school-a", role: "school_admin", status: "active" },
      { id: "a2", schoolId: "school-a", role: "school_admin", active: false },
      { id: "c1", schoolId: "school-a", role: "cashier", status: "active" },
      { id: "d1", schoolId: "school-a", role: "discipline_director", status: "active" },
      { id: "s1", schoolId: "school-a", role: "secretary", status: "active" },
      { id: "x1", schoolId: "school-b", role: "cashier", status: "active" },
    ] as AppUser[];
    expect(activeDashboardPersonnelCounts(users, "school-a")).toEqual({ school_admin: 1, cashier: 1, discipline_director: 1 });
  });
});
