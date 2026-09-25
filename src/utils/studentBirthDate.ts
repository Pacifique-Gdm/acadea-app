const DISPLAY_DATE_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const STORAGE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

export function parseStudentBirthDateInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = DISPLAY_DATE_PATTERN.exec(trimmed);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!isCalendarDate(year, month, day)) return null;
  return `${yearText}-${monthText}-${dayText}`;
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
