/** Hauteur de la bande « Arriérés encaissés » (marges, un titre et une ligne par devise),
 * gardée par un squelette pendant l'actualisation pour que la page ne saute pas. */
export function collectedArrearsBandHeight(currencyCount: number, padding = 12) {
  return padding * 2 + 2 + 20 * (1 + currencyCount);
}
