const frenchIntegerFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

export function formatCount(value: number) {
  return frenchIntegerFormatter.format(value);
}
