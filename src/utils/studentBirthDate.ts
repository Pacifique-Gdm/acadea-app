const DISPLAY_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const STORAGE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

export function parseStudentBirthDateInput(value: string) {
  if (!value) return "";
  const match = DISPLAY_DATE_PATTERN.exec(value);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!isCalendarDate(year, month, day)) return null;
  return `${yearText}-${monthText}-${dayText}`;
}

export function guideStudentBirthDateInput(value: string) {
  const digits = value.replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length < 2) return digits;
  if (digits.length < 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function deleteStudentBirthDateInput(value: string, start: number, end: number, backward: boolean) {
  const digits = value.replace(/[^0-9]/g, "");
  let from = value.slice(0, start).replace(/[^0-9]/g, "").length;
  let to = value.slice(0, end).replace(/[^0-9]/g, "").length;
  if (from === to) {
    if (backward) from = Math.max(0, from - 1);
    else to = Math.min(digits.length, to + 1);
  }
  return {
    value: guideStudentBirthDateInput(digits.slice(0, from) + digits.slice(to)),
    caret: guideStudentBirthDateInput(digits.slice(0, from)).length,
  };
}

export function formatStudentBirthDateInput(value: string) {
  if (!value) return "";
  const match = STORAGE_DATE_PATTERN.exec(value.slice(0, 10));
  if (!match) return value;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return isCalendarDate(year, month, day) ? `${dayText}/${monthText}/${yearText}` : value;
}
