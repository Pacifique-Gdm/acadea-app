import type { FeeType, School, SchoolYear } from "../types";
import type { SchoolCurrency } from "./currency";

type ArrearsTotals = { USD: number; CDF: number };

/** A configured currency remains applicable even when its current debt is zero.
 * Missing legacy settings must not silently become USD in this display. */
export function resolveApplicableArrearsCurrencies({ schools, schoolYears, feeTypes, alignedSchoolIds, totals }: {
  schools: readonly School[];
  schoolYears: readonly SchoolYear[];
  feeTypes: readonly FeeType[];
  alignedSchoolIds: readonly string[];
  totals?: ArrearsTotals;
}): SchoolCurrency[] {
  const aligned = new Set(alignedSchoolIds);
  const scopedSchools = new Map(schools.filter((school) => aligned.has(school.id)).map((school) => [school.id, school]));
  const years = new Map(schoolYears.filter((year) => scopedSchools.has(year.schoolId)).map((year) => [year.id, year]));
  const currencies = new Set<SchoolCurrency>();
  const add = (value: unknown) => { if (value === "USD" || value === "CDF") currencies.add(value); };

  for (const school of scopedSchools.values()) {
    const activeYear = years.get(school.activeSchoolYearId);
    if (activeYear?.schoolId === school.id) add(activeYear.currency ?? school.currency);
  }
  for (const fee of feeTypes) {
    const school = scopedSchools.get(fee.schoolId);
    const year = years.get(fee.schoolYearId);
    if (school && year?.schoolId === school.id) add(year.currency ?? school.currency);
  }
  if (scopedSchools.size && totals) {
    if (totals.USD > 0) currencies.add("USD");
    if (totals.CDF > 0) currencies.add("CDF");
  }
  return (["USD", "CDF"] as const).filter((currency) => currencies.has(currency));
}
