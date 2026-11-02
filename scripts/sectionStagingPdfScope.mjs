import { sections } from './sectionStagingPlan.mjs';

/** Use the PDF text layer for exact IDs; OCR is only evidence that text rendered. */
export function assertSectionPdfScope(embeddedText, renderedText, allowed) {
  const exact = embeddedText.toUpperCase().replace(/\s/g, '');
  const visible = renderedText.toUpperCase().replace(/\s/g, '');
  if (!visible.includes('FICTIF') || !visible.includes('DATEDENAISSANCE')) {
    throw new Error('PDF : nom ou colonne non démontré sur les pages rendues.');
  }
  for (const [i, section] of sections.entries()) {
    if (exact.includes(`FICTIF0${i}`) !== allowed.includes(section)) {
      throw new Error('PDF : contenu de section inattendu dans la couche texte.');
    }
    if (exact.includes(`FICTIF1${i}`)) throw new Error('PDF contenant une autre école.');
  }
}
