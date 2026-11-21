type ClassFields = { classId?: string; className?: string };
type PaymentFields = { studentId?: string; schoolId?: string; schoolYearId?: string; annee_scolaire_id?: string };

export declare const CLASS_CHANGE_WITH_PAYMENTS_MESSAGE: string;
export declare function isClassChange(previous: ClassFields | undefined | null, next: ClassFields | undefined | null): boolean;
export declare function hasYearPayments(payments: readonly PaymentFields[] | undefined | null, studentId: string, schoolId: string, schoolYearId: string): boolean;
