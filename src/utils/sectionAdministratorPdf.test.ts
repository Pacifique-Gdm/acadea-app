import { describe, expect, it } from "vitest";
import type { AppUser, Payment, Student } from "../types";
import { assertSectionPaymentReceiptScope, assertSectionStudentPdfScope } from "./sectionAdministratorPdf";

const actor = { role: "primary_admin", schoolId: "school-a", status: "active", active: true, sectionIds: ["Primaire"] } as AppUser;
const student = { id: "student-a", schoolId: "school-a", schoolYearId: "year-a", section: "Primaire" } as Student;
const payment = { id: "payment-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a" } as Payment;

describe("section administrator PDF boundary", () => {
  it("accepts only assigned students in the selected school and year", () => {
    expect(() => assertSectionStudentPdfScope(actor, "school-a", "year-a", [student])).not.toThrow();
    for (const invalid of [{ ...student, section: "Secondaire" }, { ...student, section: undefined },
      { ...student, schoolId: "school-b" }, { ...student, schoolYearId: "year-b" }]) {
      expect(() => assertSectionStudentPdfScope(actor, "school-a", "year-a", [student, invalid] as Student[])).toThrow();
    }
    expect(() => assertSectionStudentPdfScope({ ...actor, active: false }, "school-a", "year-a", [student])).toThrow();
  });

  it("rejects receipts with a foreign payer, school or year, including stale selections", () => {
    expect(() => assertSectionPaymentReceiptScope(actor, "school-a", "year-a", student, payment)).not.toThrow();
    expect(() => assertSectionPaymentReceiptScope(actor, "school-a", "year-a", student,
      { ...payment, schoolYearId: "old-year", collectionSchoolYearId: "year-a" })).not.toThrow();
    for (const invalid of [{ ...payment, studentId: "student-b" }, { ...payment, schoolId: "school-b" },
      { ...payment, schoolYearId: "year-b" }]) {
      expect(() => assertSectionPaymentReceiptScope(actor, "school-a", "year-a", student, invalid)).toThrow();
    }
  });

  it("does not change existing administrator exports", () => {
    expect(() => assertSectionStudentPdfScope({ ...actor, role: "school_admin" }, "school-a", "year-a",
      [{ ...student, section: "Secondaire" }])).not.toThrow();
  });
});
