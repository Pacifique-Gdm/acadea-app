import type { FeeType } from "../types";

export function normalizeFeeTypeIdentityPart(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr");
}

export function feeTypeBusinessKey(fee: Pick<FeeType, "schoolId" | "schoolYearId" | "name" | "className" | "classOptionKey">) {
  return JSON.stringify([
    normalizeFeeTypeIdentityPart(fee.schoolId),
    normalizeFeeTypeIdentityPart(fee.schoolYearId),
    normalizeFeeTypeIdentityPart(fee.name),
    normalizeFeeTypeIdentityPart(fee.classOptionKey ?? fee.className ?? ""),
  ]);
}
