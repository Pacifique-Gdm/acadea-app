import { describe, expect, it } from 'vitest';
import { changeCounterId, counterScopes, needsSchoolCheck } from './allocationChangeCounter.js';

describe('compteur de changements de la répartition', () => {
  it('une école et une année par document source', () => {
    expect(counterScopes(undefined, { schoolId: 'school-a', schoolYearId: 'year-a', revision: 'x' }, 'hash')).toEqual([{ schoolId: 'school-a', schoolYearId: 'year-a' }]);
    expect(changeCounterId('school-a', 'year-a')).toBe('school-a__year-a');
  });
  it('année lue dans l’identifiant école__année quand le champ manque (catalogue, partages)', () => {
    expect(counterScopes({ revision: 1 }, { revision: 2 }, 'school-a__year-a')).toEqual([{ schoolId: 'school-a', schoolYearId: 'year-a' }]);
  });
  it('répartition en attente sans année : école seule (année active lue ensuite)', () => {
    expect(counterScopes(undefined, { schoolId: 'school-a', status: 'pending' }, 'pending-hash')).toEqual([{ schoolId: 'school-a' }]);
  });
  it('création, suppression et changement d’école comptés une fois par périmètre', () => {
    const a = { schoolId: 'school-a', schoolYearId: 'year-a' };
    expect(counterScopes(a, undefined, 'x')).toHaveLength(1);
    expect(counterScopes(a, { ...a, revision: 2 }, 'x')).toHaveLength(1);
    expect(counterScopes(a, { schoolId: 'school-b', schoolYearId: 'year-b' }, 'x')).toHaveLength(2);
  });
  it('un effacement vérifie d’abord que l’école existe encore (pas de compteur orphelin)', () => {
    expect(needsSchoolCheck(undefined)).toBe(true);
    expect(needsSchoolCheck({ schoolId: 'school-a' })).toBe(false);
  });
  it('identifiants invalides ignorés', () => {
    expect(counterScopes(undefined, { schoolId: 'a/b', schoolYearId: 'year' }, 'x')).toEqual([]);
    expect(counterScopes(undefined, undefined, 'x')).toEqual([]);
  });
});
