/** Attend qu'une condition devienne vraie (vérifiée toutes les `stepMs`), au plus `timeoutMs`.
 * Sert à la fiche élève : un clic sur « Sauver » pendant le chargement des classes attend la fin du chargement au lieu d'échouer. */
export async function waitForCondition(check: () => boolean, timeoutMs = 15000, stepMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return true;
}
