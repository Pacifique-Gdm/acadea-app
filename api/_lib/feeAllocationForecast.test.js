import { describe, expect, it } from 'vitest';
import { calculateAllocationForecast } from './feeAllocationForecast.js';

const rubric = n => n.toString(16).repeat(32);
function fixture() {
  const fee = { id: 'fee', schoolId: 's', schoolYearId: 'y', amount: 60, className: '1ère' };
  return { schoolId: 's', yearId: 'y', currency: 'USD', operational: false, versions: [], fees: [fee],
    students: Array.from({ length: 10 }, (_, i) => ({ id: `student-${i}`, schoolId: 's', schoolYearId: 'y', className: '1ère', status: 'ACTIVE' })),
    configs: [{ id: 'c', feeTypeId: 'fee', schoolId: 's', schoolYearId: 'y', currency: 'USD', className: '1ère',
      draft: { feeAmountMinor: 6000, rubrics: [4000, 2000, 4000].map((basisPoints, i) => ({ id: rubric(i+1), name: `Rubrique ${i+1}`, mode: 'percent', basisPoints })) } }] };
}
describe('prévu annuel net, sans écritures financières', () => {
  it('compte dix élèves sans aucun paiement : 600 USD = 240 + 120 + 240', () => {
    const data = fixture(), before = structuredClone(data);
    const result = calculateAllocationForecast(data);
    expect(result.rows.map(r => r.amountMinor)).toEqual([24000, 12000, 24000, 0]);
    expect(result.studentCount).toBe(10); expect(data).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('student-');
  });
  it('ajout, archivage, réduction et exonération modifient seulement le prévu', () => {
    const data = fixture();
    data.students.push({ ...data.students[0], id: 'added' });
    expect(calculateAllocationForecast(data).rows.reduce((n, r) => n + r.amountMinor, 0)).toBe(66000);
    data.students[0].status = 'ARCHIVED';
    data.students[1].financialSupport = { reduction: { schoolYearId: 'y', lines: { fee: { reductionMinor: 3000 } } } };
    data.students[2].financialSupport = { exemption: { schoolYearId: 'y', lines: { fee: { reductionMinor: 6000 } } } };
    expect(calculateAllocationForecast(data).rows.map(r => r.amountMinor)).toEqual([20400, 10200, 20400, 0]);
  });
  it('réutilise la ventilation des encaissements pour un fixe lorsque le net est inférieur au tarif', () => {
    const data = fixture(); data.students = [data.students[0]];
    data.configs[0].draft.rubrics = [{ id: rubric(1), name: 'Fixe', mode: 'fixed', fixedMinor: 3000 }];
    data.students[0].financialSupport = { r: { schoolYearId: 'y', lines: { fee: { reductionMinor: 3000, commitmentMinor: 3000 } } } };
    expect(calculateAllocationForecast(data).rows.map(r => r.amountMinor)).toEqual([1500, 1500]);
  });
  it('comprend les frais non répartis, mais ni les autres écoles, ni les années anciennes', () => {
    const data = fixture(); data.configs = [];
    data.students.push({ ...data.students[0], id: 'foreign', schoolId: 'foreign' }, { ...data.students[0], id: 'old', schoolYearId: 'old' });
    expect(calculateAllocationForecast(data).rows).toEqual([expect.objectContaining({ rubricId: 'UNALLOCATED', amountMinor: 60000, studentsCount: 10 })]);
  });
  it('respecte les tarifs par option et refuse une devise étrangère', () => {
    const data = fixture(); data.configs = [];
    data.fees[0].className = '1ère Humanité'; data.fees[0].classOptionKey = '1ère Humanité::option::Latin';
    data.students[0].className = '1ère Humanité'; data.students[0].option = 'Latin';
    data.students[1].className = '1ère Humanité'; data.students[1].option = 'Sciences';
    expect(calculateAllocationForecast(data).rows[0].amountMinor).toBe(6000);
    data.fees[0].currency = 'CDF'; expect(() => calculateAllocationForecast(data)).toThrow('devise');
  });
  it('ne laisse pas un brouillon actif changer la prévision publiée', () => {
    const data = fixture(); data.operational = true;
    expect(calculateAllocationForecast(data).rows[0]).toMatchObject({ rubricId: 'UNALLOCATED', amountMinor: 60000 });
    data.configs[0].currentVersionId = 'missing'; expect(() => calculateAllocationForecast(data)).toThrow('manquante');
  });
  it('refuse un tarif changé plutôt que de recalculer silencieusement les poids du brouillon', () => {
    const data = fixture(); data.fees[0].amount = 99;
    expect(() => calculateAllocationForecast(data)).toThrow('Tarif, classe ou version modifié');
  });
});
