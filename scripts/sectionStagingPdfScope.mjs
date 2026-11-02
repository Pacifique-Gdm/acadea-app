import { sections } from './sectionStagingPlan.mjs';

/** Acadéa rasterizes report content: verify the rendered pages, not their sparse text layer. */
export function assertSectionPdfScope(renderedText, allowed) {
  const visible = renderedText.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s/g, '');
  if (!visible.includes('FICTIF') || !visible.includes('02/01/2015')) {
    throw new Error('PDF : nom ou date non démontré sur les pages rendues.');
  }
  const digit = (value) => ({ O: '0', I: '1', L: '1', Z: '2' })[value] ?? value;
  const ids = new Set([...visible.matchAll(/FICTIF([0-3OILZ])([0-3OILZ])/g)]
    .map((match) => `${digit(match[1])}${digit(match[2])}`));
  for (const [i, section] of sections.entries()) {
    if (ids.has(`0${i}`) !== allowed.includes(section)) {
      throw new Error('PDF : contenu de section inattendu dans les pages rendues.');
    }
    if (ids.has(`1${i}`)) throw new Error('PDF contenant une autre école.');
  }
}
