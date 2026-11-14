import { describe, it, expect } from 'vitest';
import { panelPersonnelFixture } from '../../scripts/feeAllocationPanelFixtures.mjs';
import { nextSchoolStaffEmail } from '../../src/utils/schoolAccountCredentials';

describe('fixture complète du paiement de personnel historique', () => {
  const tag = `e2e-allocation-${'a'.repeat(32)}`;
  const schoolId = `${tag}-volume`, yearId = `${tag}-volume-year`;
  const school = { id: schoolId, name: 'École fictive' };
  it('reproduit le rejet de la fixture incomplète par le lecteur du Menu', () => {
    const incomplete = { role: 'teacher', name: 'Fictif', schoolId };
    expect(() => nextSchoolStaffEmail(school, 'cashier', [incomplete], [])).toThrow(/trim/);
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
