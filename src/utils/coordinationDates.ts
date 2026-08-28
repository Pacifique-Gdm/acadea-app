export function localDateInputValue(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function schoolYearDatesFromName(name: string) {
  const match = name.trim().match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) return null;
  return { startsAt: `${startYear}-09-01`, endsAt: `${endYear}-07-31` };
}

export function financialDateRangeError(from: string, to: string, today = localDateInputValue()) {
  if ((from && from > today) || (to && to > today)) return "Une date future n'est pas autorisée.";
  if (from && to && from > to) return "La date de début doit précéder ou être égale à la date de fin.";
  return "";
}
