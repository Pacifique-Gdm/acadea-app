/** Positionne le curseur d'après les caractères monétaires, sans compter les séparateurs de milliers. */
export function moneyInputCaret(raw: string, rawCaret: number, formatted: string) {
  const count = raw.slice(0, rawCaret).replace(/[^\d,.]/g, "").length;
  if (!count) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/[\d,]/.test(formatted[index])) seen += 1;
    if (seen === count) return index + 1;
  }
  return formatted.length;
}
