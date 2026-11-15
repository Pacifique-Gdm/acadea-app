import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { forecastScopes } from './forecastSignals.js';

const student = { schoolId: 'school-a', schoolYearId: 'year-a', className: '1ère Primaire', status: 'ACTIVE' };
describe('invalidations du prévu annuel, sans écriture financière', () => {
  it('ne signale pas un changement de téléphone, photo ou métadonnée', () => {
    expect(forecastScopes(student, { ...student, phone: 'fictif', photoUrl: 'fictif', updatedAt: 'later' }, 'student')).toEqual([]);
  });
  it.each(['className', 'option', 'status', 'deletedAt', 'financialSupport'])('signale %s et utilise la même clé que l’API', field => {
    const scopes = forecastScopes(student, { ...student, [field]: 'changed' }, 'student');
    expect(scopes).toEqual([{ schoolId: 'school-a', schoolYearId: 'year-a', id: createHash('sha256').update(JSON.stringify(['school-a', 'year-a'])).digest('hex') }]);
  });
  it('signale la création, suppression et les deux périmètres lors d’un transfert', () => {
    expect(forecastScopes(undefined, student, 'student')).toHaveLength(1);
    expect(forecastScopes(student, undefined, 'student')).toHaveLength(1);
    expect(forecastScopes(student, { ...student, schoolId: 'school-b', schoolYearId: 'year-b' }, 'student')).toHaveLength(2);
    expect(forecastScopes(undefined, { ...student, schoolId: 'a/b' }, 'student')).toEqual([]);
  });
  it.each(['amount', 'className', 'classOptionKey', 'currency'])('signale un changement de tarif %s', field => {
    const fee = { schoolId: 'school-a', schoolYearId: 'year-a', amount: 60 };
    expect(forecastScopes(fee, { ...fee, [field]: 'changed' }, 'fee')).toHaveLength(1);
  });
});
