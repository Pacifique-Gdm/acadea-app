/** Playwright transport errors can include Authorization headers. Never allow
 * an event callback rejection to reach Node's raw unhandled-error printer. */
export function guardedRoute(handler, failures) {
  return async route => {
    try { await handler(route); }
    catch {
      failures.push('Transport de recette interrompu ; aucune réponse serveur simulée.');
      await route.abort('connectionfailed').catch(() => {});
    }
  };
}
export function redactRecipeError(error, sensitiveValues = []) {
  let text = String(error?.message ?? error);
  for (const value of sensitiveValues) if (value) text = text.replaceAll(value, '[masqué]');
  return text.replace(/Bearer\s+[^\s'"\x1b]+/gi, 'Bearer [masqué]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[session masquée]').slice(0, 600);
}
