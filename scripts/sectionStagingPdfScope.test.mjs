import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSectionPdfScope } from './sectionStagingPdfScope.mjs';

test('rendered PDF OCR verifies scope even when zero looks like letter O', () => {
  assert.doesNotThrow(() => assertSectionPdfScope('FICTIFOO RECETTE Test 02/01/2015', ['Maternelle']));
  assert.throws(() => assertSectionPdfScope('FICTIFOO FICTIFO1 02/01/2015', ['Maternelle']), /section inattendu/);
  assert.throws(() => assertSectionPdfScope('FICTIFOO FICTIF1O 02/01/2015', ['Maternelle']), /autre école/);
  assert.throws(() => assertSectionPdfScope('FICTIFOO', ['Maternelle']), /pages rendues/);
});
