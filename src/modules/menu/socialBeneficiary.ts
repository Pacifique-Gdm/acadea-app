type BeneficiaryStudent = {
  nom?: string;
  postnom?: string;
  prenom?: string;
  className?: string;
};

type BeneficiaryDecision = {
  studentName: string;
  className?: string;
};

/** Keep the decision's recorded class when its student is no longer available. */
export function socialBeneficiaryLabel(
  student: BeneficiaryStudent | undefined,
  decision: BeneficiaryDecision,
): string {
  const currentName = student
    ? [student.nom, student.postnom, student.prenom].filter(Boolean).join(" ").trim()
    : "";
  const name = currentName || decision.studentName;
  const currentClass = typeof student?.className === "string" ? student.className.trim() : "";
  const recordedClass = typeof decision.className === "string" ? decision.className.trim() : "";
  const className = currentClass || recordedClass;
  return className ? `${name} — ${className}` : name;
}
