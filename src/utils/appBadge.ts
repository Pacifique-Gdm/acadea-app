/** Lot 24 : met à jour le badge de l'icône d'Acadéa (nombre de notifications non lues). */
export function syncAppBadge(count: number) {
  const nav = typeof navigator === "undefined" ? undefined : navigator as Navigator & { setAppBadge?: (value?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav?.setAppBadge) return;
  const action = count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.();
  void action?.catch(() => undefined);
}
