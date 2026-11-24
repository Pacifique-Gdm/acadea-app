type ScrollableRoot = { scrollTop: number };
type ScrollDocument = { querySelectorAll: (selector: string) => ArrayLike<ScrollableRoot>; scrollingElement?: ScrollableRoot | null };
type ScrollWindow = { scrollTo: (x: number, y: number) => void };

/** Nouvel onglet : l'écran s'ouvre toujours tout en haut. Selon le portail, la zone qui défile
 * est la fenêtre (Super Administrateur) ou l'élément <main> (Administrateur, Caissier, Parent,
 * Enseignant, Coordination…). Les deux sont remis en haut. Les petites zones qui défilent
 * à l'intérieur d'un onglet (tableaux, listes) ne sont pas touchées. */
export function resetTabScroll(doc: ScrollDocument | undefined = typeof document === "undefined" ? undefined : document, win: ScrollWindow | undefined = typeof window === "undefined" ? undefined : window) {
  if (!doc) return;
  const mains = doc.querySelectorAll("main");
  for (let index = 0; index < mains.length; index += 1) mains[index].scrollTop = 0;
  if (doc.scrollingElement) doc.scrollingElement.scrollTop = 0;
  win?.scrollTo(0, 0);
}
