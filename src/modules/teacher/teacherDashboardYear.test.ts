import { describe, expect, it } from "vitest";
import type { SchoolYear } from "../../types";
import { teacherDashboardYear } from "./teacherDashboardYear";

const year = (id: string, schoolId = "a", status: SchoolYear["status"] = "active") => ({ id, schoolId, status, name: id, startsAt: "2026-09-01", endsAt: "2027-07-01" }) as SchoolYear;

describe("année canonique du Dashboard Enseignant", () => {
  it("préfère le pointeur de l'école malgré dates et autres années actives", () => {
    expect(teacherDashboardYear({ id: "a", activeSchoolYearId: "second" }, [year("first"), year("second"), year("other", "b")])).toMatchObject({ status: "active", year: { id: "second" } });
  });
  it("accepte une année active unique sans pointeur, sans en choisir parmi plusieurs", () => {
    expect(teacherDashboardYear({ id: "a" }, [year("old", "a", "archived"), year("only")])).toMatchObject({ status: "active", year: { id: "only" } });
    expect(teacherDashboardYear({ id: "a" }, [year("one"), year("two")])).toEqual({ status: "inconsistent" });
  });
  it("refuse les pointeurs invalides et l'absence d'année active", () => {
    expect(teacherDashboardYear({ id: "a", activeSchoolYearId: "b-year" }, [year("b-year", "b")])).toEqual({ status: "inconsistent" });
    expect(teacherDashboardYear({ id: "a", activeSchoolYearId: "old" }, [year("old", "a", "archived")])).toEqual({ status: "inconsistent" });
    expect(teacherDashboardYear({ id: "a" }, [year("old", "a", "archived")])).toEqual({ status: "missing" });
  });
});
