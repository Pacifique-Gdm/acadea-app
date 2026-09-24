function normalizedLetter(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

export function subclassLetterAt(index) {
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Index de sous-classe invalide.");
  let remaining = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

export function nextSubclassLetters(existingLabels, count = 1) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new RangeError("Nombre de sous-classes invalide.");
  const used = new Set(existingLabels.map(normalizedLetter));
  const labels = [];
  for (let index = 0; labels.length < count; index += 1) {
    const label = subclassLetterAt(index);
    if (!used.has(label)) labels.push(label);
  }
  return labels;
}

export function isCanonicalSubclassLetter(value) {
  return typeof value === "string" && /^[A-Z]+$/.test(value);
}
