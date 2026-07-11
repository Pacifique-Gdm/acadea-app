import type { FeeType, Payment, Student } from "../types";
import { feeAppliesToStudent } from "./stats";

export type SchoolYearDataIndexes = {
  paymentsByStudentId: Map<string, Payment[]>;
  paymentsByStudentAndFeeType: Map<string, Map<string, Payment[]>>;
  studentsById: Map<string, Student>;
  feeTypesById: Map<string, FeeType>;
  applicableFeeTypesByStudentId: Map<string, FeeType[]>;
};

function addToListMap<TKey, TValue>(items: Map<TKey, TValue[]>, key: TKey, value: TValue) {
  const values = items.get(key) ?? [];
  values.push(value);
  items.set(key, values);
}

export function buildSchoolYearDataIndexes(students: Student[], feeTypes: FeeType[], payments: Payment[]): SchoolYearDataIndexes {
  const paymentsByStudentId = new Map<string, Payment[]>();
  const paymentsByStudentAndFeeType = new Map<string, Map<string, Payment[]>>();
  const studentsById = new Map<string, Student>();
  const feeTypesById = new Map<string, FeeType>();
  const applicableFeeTypesByStudentId = new Map<string, FeeType[]>();

  students.forEach((student) => {
    studentsById.set(student.id, student);
  });

  feeTypes.forEach((fee) => {
    feeTypesById.set(fee.id, fee);
  });

  payments.forEach((payment) => {
    addToListMap(paymentsByStudentId, payment.studentId, payment);
    const studentPaymentsByFee = paymentsByStudentAndFeeType.get(payment.studentId) ?? new Map<string, Payment[]>();
    addToListMap(studentPaymentsByFee, payment.feeTypeId, payment);
    paymentsByStudentAndFeeType.set(payment.studentId, studentPaymentsByFee);
  });

  students.forEach((student) => {
    applicableFeeTypesByStudentId.set(
      student.id,
      feeTypes.filter((fee) => feeAppliesToStudent(fee, student)),
    );
  });

  return {
    paymentsByStudentId,
    paymentsByStudentAndFeeType,
    studentsById,
    feeTypesById,
    applicableFeeTypesByStudentId,
  };
}

export function getPaymentsForStudentFee(indexes: Pick<SchoolYearDataIndexes, "paymentsByStudentAndFeeType">, studentId: string, feeTypeId: string) {
  return indexes.paymentsByStudentAndFeeType.get(studentId)?.get(feeTypeId) ?? [];
}

export function sumPayments(payments: Payment[]) {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

export function sumPaymentsForStudentFee(indexes: Pick<SchoolYearDataIndexes, "paymentsByStudentAndFeeType">, studentId: string, feeTypeId: string) {
  return sumPayments(getPaymentsForStudentFee(indexes, studentId, feeTypeId));
}
