import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSectionPdfScope } from './sectionStagingPdfScope.mjs';

test('exact PDF text verifies scope even when OCR confuses zero with letter O', () => {
  assert.doesNotThrow(() => assertSectionPdfScope('FICTIF00 DATE DE NAISSANCE', 'FICTIFOO DATE DE NAISSANCE', ['Maternelle']));
  assert.throws(() => assertSectionPdfScope('FICTIF00 FICTIF01', 'FICTIFOO DATE DE NAISSANCE', ['Maternelle']), /section inattendu/);
  assert.throws(() => assertSectionPdfScope('FICTIF00 FICTIF10', 'FICTIFOO DATE DE NAISSANCE', ['Maternelle']), /autre école/);
  assert.throws(() => assertSectionPdfScope('FICTIF00', 'FICTIFOO', ['Maternelle']), /pages rendues/);
});
