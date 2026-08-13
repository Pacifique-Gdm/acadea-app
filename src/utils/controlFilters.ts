import type { FeeType, ParentProfile, Payment, Student } from "../types";
import { feeAppliesToStudent, feeTargetKey } from "./feeTargets";
import { formatStudentClassName, getClassSection } from "./studentClasses";

export function getControlClassKey(student: Pick<Student, "className" | "option">) {
  return getClassSection(student.className) === "Secondaire" ? feeTargetKey(student.className, student.option) : student.className;
}

export function buildControlClassChoices(students: Student[]) {
  return Array.from(new Map(students.map((student) => {
    const key = getControlClassKey(student);
    return [key, { key, label: formatStudentClassName(student), student }];
  })).values()).sort((first, second) => first.label.localeCompare(second.label, "fr"));
}

export function feeNamesForControlClass(feeTypes: FeeType[], student?: Student) {
  if (!student) return [];
  return Array.from(new Set(feeTypes.filter((fee) => feeAppliesToStudent(fee, student)).map((fee) => fee.name)));
}

export type ControlFeeGroup = { key: string; name: string; ids: string[] };

export function buildControlFeeGroups(feeTypes: FeeType[], classKey: string, classStudent?: Student) {
  const applicableFees = classKey && classKey !== "all"
    ? classStudent ? feeTypes.filter((fee) => feeAppliesToStudent(fee, classStudent)) : []
    : feeTypes;

  return Array.from(
    applicableFees.reduce<Map<string, ControlFeeGroup>>((items, fee) => {
      const name = fee.name.trim();
      const key = name.toLowerCase();
      if (!key) return items;
      const existing = items.get(key);
      items.set(key, existing ? { ...existing, ids: [...existing.ids, fee.id] } : { key, name, ids: [fee.id] });
      return items;
    }, new Map()).values(),
  );
}

export function feeNamesForWarningClass(feeTypes: FeeType[], classKey: string, student?: Student) {
  if (classKey === "all") return Array.from(new Set(feeTypes.map((fee) => fee.name)));
  return feeNamesForControlClass(feeTypes, student);
}

export function selectPaymentWarningRecipients({
  students,
  parents,
  feeTypes,
  payments,
  schoolId,
  schoolYearId,
  classKey,
  feeName,
  requiredAmount,
}: {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  schoolId: string;
  schoolYearId: string;
  classKey: string;
  feeName: string;
  requiredAmount: number;
}) {
  const matchingFees = feeTypes.filter((fee) => fee.schoolId === schoolId && fee.schoolYearId === schoolYearId && fee.name === feeName);
  const scopedParents = new Map(
    parents
      .filter((parent) => parent.schoolId === schoolId && parent.schoolYearId === schoolYearId && parent.status === "active")
      .map((parent) => [parent.id, parent]),
  );
  const recipients = new Map<string, { parent: ParentProfile; students: Student[] }>();

  students
    .filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId)
    .filter((student) => classKey === "all" || getControlClassKey(student) === classKey)
    .forEach((student) => {
      const parent = student.parentId ? scopedParents.get(student.parentId) : undefined;
      if (!parent) return;
      const applicableFeeIds = new Set(matchingFees.filter((fee) => feeAppliesToStudent(fee, student)).map((fee) => fee.id));
      if (applicableFeeIds.size === 0) return;
      const paid = payments
        .filter(
          (payment) =>
            payment.schoolId === schoolId &&
            payment.schoolYearId === schoolYearId &&
            payment.studentId === student.id &&
            applicableFeeIds.has(payment.feeTypeId),
        )
        .reduce((sum, payment) => sum + payment.amount, 0);
      if (paid >= requiredAmount) return;
      const current = recipients.get(parent.id);
      recipients.set(parent.id, { parent, students: current ? [...current.students, student] : [student] });
    });

  return Array.from(recipients.values());
}
