import { describe, it, expect } from 'vitest';
import { panelPersonnelFixture } from '../../scripts/feeAllocationPanelFixtures.mjs';
import { nextSchoolStaffEmail } from '../../src/utils/schoolAccountCredentials';

describe('fixture complète du paiement de personnel historique', () => {
  const tag = `e2e-allocation-${'a'.repeat(32)}`;
  const schoolId = `${tag}-volume`, yearId = `${tag}-volume-year`;
  const school = { id: schoolId, name: 'École fictive' };
  // Autrefois, une fiche sans e-mail faisait planter le lecteur du Menu (`.trim()` sur une
  // valeur absente) ; ce défaut est corrigé : la fiche incomplète est simplement ignorée.
  it('une fiche sans e-mail ne fait plus planter le lecteur du Menu', () => {
    const incomplete = { role: 'teacher', name: 'Fictif', schoolId };
    expect(nextSchoolStaffEmail(school, 'cashier', [incomplete], [])).toBe('caissier001@ecolefictive.com');
  });
  it('fournit les champs requis au vrai lecteur du Menu sans modifier ses protections', () => {
    const profile = panelPersonnelFixture(tag, schoolId, yearId);
    expect(profile.email).toMatch(/@example\.invalid$/);
    expect(profile.activeSchoolYearId).toBe(yearId);
    expect(nextSchoolStaffEmail(school, 'cashier', [profile], [])).toBe('caissier001@ecolefictive.com');
  });
  it('refuse un établissement hors des fixtures isolées', () => {
    expect(() => panelPersonnelFixture(tag, 'real-school', yearId)).toThrow();
  });
});
