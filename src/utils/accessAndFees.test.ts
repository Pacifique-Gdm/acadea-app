import { describe, expect, it } from "vitest";
import type { AppUser, FeeType, Student } from "../types";
import { canEnterRoute, getDefaultRoute, validateParent, validateSecretary, validateStudyDirector, validateTeacher } from "../services/auth";
import { feeAppliesToStudent, feeTargetKey } from "./feeTargets";

describe("autorisations par rôle", () => {
  it("réserve la plateforme au super administrateur", () => {
    expect(canEnterRoute({ role: "super_admin" } as AppUser, "/platform")).toBe(true);
    expect(canEnterRoute({ role: "school_admin", schoolId: "school-a" } as AppUser, "/platform")).toBe(false);
    expect(getDefaultRoute("super_admin")).toBe("/platform");
  });

  it("exige le schoolId pour le portail école", () => {
    expect(canEnterRoute({ role: "cashier", schoolId: "school-a" } as AppUser, "/dashboard")).toBe(true);
    expect(canEnterRoute({ role: "cashier" } as AppUser, "/dashboard")).toBe(false);
  });

  it("autorise uniquement un Secrétaire actif rattaché à une école", () => {
    expect(canEnterRoute({ role: "secretary", schoolId: "school-a", status: "active" } as AppUser, "/dashboard")).toBe(true);
    expect(validateSecretary({ role: "secretary", schoolId: "school-a", status: "active" } as AppUser)).toBe(true);
    expect(validateSecretary({ role: "secretary", schoolId: "school-a", status: "inactive" } as AppUser)).toBe(false);
    expect(validateSecretary({ role: "secretary", status: "active" } as AppUser)).toBe(false);
  });

  it("bloque un compte désactivé et un rôle inconnu", () => {
    expect(canEnterRoute({ role: "school_admin", schoolId: "school-a", status: "inactive" } as AppUser, "/dashboard")).toBe(false);
    expect(canEnterRoute({ role: "unknown", schoolId: "school-a" } as unknown as AppUser, "/dashboard")).toBe(false);
  });

  it("isole la route du Directeur des études", () => {
    const director = { id: "studies-a", role: "study_director", schoolId: "school-a", status: "active" } as AppUser;
    expect(validateStudyDirector(director)).toBe(true);
    expect(canEnterRoute(director, "/studies")).toBe(true);
    expect(canEnterRoute(director, "/dashboard")).toBe(false);
    expect(canEnterRoute(director, "/platform")).toBe(false);
    expect(canEnterRoute({ ...director, status: "inactive" }, "/studies")).toBe(false);
    expect(canEnterRoute({ ...director, role: "cashier" }, "/studies")).toBe(false);
    expect(getDefaultRoute("study_director")).toBe("/studies");
  });

  it("isole la route de l'Enseignant actif", () => {
    const teacher = { id: "teacher-user-a", role: "teacher", schoolId: "school-a", status: "active" } as AppUser;
    expect(validateTeacher(teacher)).toBe(true);
    expect(canEnterRoute(teacher, "/teacher")).toBe(true);
    expect(canEnterRoute(teacher, "/dashboard")).toBe(false);
    expect(canEnterRoute({ ...teacher, status: "inactive" }, "/teacher")).toBe(false);
    expect(canEnterRoute({ ...teacher, schoolId: undefined }, "/teacher")).toBe(false);
    expect(getDefaultRoute("teacher")).toBe("/teacher");
  });

  it("refuse un parent inactif ou sans rattachement", () => {
    expect(validateParent({ role: "parent", schoolId: "school-a", parentId: "parent-a", status: "active" } as AppUser)).toBe(true);
    expect(validateParent({ role: "parent", schoolId: "school-a", parentId: "parent-a", status: "inactive" } as AppUser)).toBe(false);
  });
});

describe("ciblage des frais", () => {
  const sciences = { className: "1ère Humanité", option: "Sciences" } as Student;

  it("distingue les options d'une même classe", () => {
    const fee = { classOptionKey: feeTargetKey("1ère Humanité", "Sciences") } as FeeType;
    expect(feeAppliesToStudent(fee, sciences)).toBe(true);
    expect(feeAppliesToStudent(fee, { ...sciences, option: "Littéraire" })).toBe(false);
  });

  it("applique un frais global à tous les élèves", () => {
    expect(feeAppliesToStudent({} as FeeType, sciences)).toBe(true);
  });
});
