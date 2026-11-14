import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AllocationActionButton } from './AllocationActionButton';

describe('bouton asynchrone de répartition', () => {
  it('réserve les deux libellés dans la même cellule et expose le chargement accessible', () => {
    const idle = renderToStaticMarkup(createElement(AllocationActionButton, { children: 'Exporter PDF' }));
    const busy = renderToStaticMarkup(createElement(AllocationActionButton, { children: 'Exporter PDF', busy: true }));
    for (const html of [idle, busy]) {
      expect(html.match(/grid-area:1 \/ 1/g)).toHaveLength(2);
      expect(html).toContain('min-h-11');
      expect(html).toContain('Exporter PDF'); expect(html).toContain('Chargement...');
    }
    expect(busy).toContain('disabled=""'); expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-label="Chargement..."');
    expect(idle).not.toContain('disabled=""'); expect(idle).toContain('aria-busy="false"');
  });
});
