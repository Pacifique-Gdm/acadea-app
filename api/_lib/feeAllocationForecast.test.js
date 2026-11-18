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
    // Lot 27c-1 : tableaux 1 et 2 séparés ; leur somme par rubrique est inchangée.
    const byRubric = (rows) => [...rows.reduce((m, r) => m.set(r.rubricId, (m.get(r.rubricId) ?? 0) + r.amountMinor), new Map()).values()];
    expect(byRubric(calculateAllocationForecast(data).rows)).toEqual([20400, 10200, 20400, 0]);
    expect(calculateAllocationForecast(data).rows.filter(r => r.table === 2).reduce((n, r) => n + r.amountMinor, 0)).toBeGreaterThan(0);
  });
  it('réutilise la ventilation des encaissements pour un fixe lorsque le net est inférieur au tarif', () => {
    const data = fixture(); data.students = [data.students[0]];
    data.configs[0].draft.rubrics = [{ id: rubric(1), name: 'Fixe', mode: 'fixed', fixedMinor: 3000 }];
    data.students[0].financialSupport = { r: { schoolYearId: 'y', lines: { fee: { reductionMinor: 3000, commitmentMinor: 3000 } } } };
    expect(calculateAllocationForecast(data).rows.filter(r => r.table === 2).map(r => r.amountMinor)).toEqual([1500, 1500]);
    expect(calculateAllocationForecast(data).rows.filter(r => r.table === 1).every(r => r.amountMinor === 0)).toBe(true);
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

describe('lot 27c-4 : prévu du tableau 2 selon la partie 2', () => {
  const published = () => {
    const data = fixture(), rubrics = data.configs[0].draft.rubrics;
    data.operational = true;
    data.configs[0] = { ...data.configs[0], currentVersionId: 'v1', socialVersionId: 'sv1' };
    data.versions = [{ id: 'v1', feeTypeId: 'fee', schoolId: 's', schoolYearId: 'y', currency: 'USD', className: '1ère', status: 'published', feeAmountMinor: 6000, rubrics }];
    data.students[0].financialSupport = { d: { schoolYearId: 'y', lines: { fee: { reductionMinor: 2000 } } } };
    return { data, rubrics };
  };
  const table = (rows, n) => Object.fromEntries(rows.filter(r => r.table === n).map(r => [r.rubricId, r.amountMinor]));
  it('copie de la partie 1 : tableau 2 identique à aujourd\u2019hui', () => {
    const { data, rubrics } = published();
    const before = table(calculateAllocationForecast({ ...data, socialVersions: [] }).rows, 2);
    data.socialVersions = [{ id: 'sv1', partOneVersionId: 'v1', status: 'published', rubrics: rubrics.map(r => ({ ...r })) }];
    expect(table(calculateAllocationForecast(data).rows, 2)).toEqual(before);
  });
  it('partie 2 différente : tableau 2 sur le net (40 USD) avec un montant fixe, tableau 1 inchangé', () => {
    const { data, rubrics } = published();
    const one = table(calculateAllocationForecast(data).rows, 1);
    data.socialVersions = [{ id: 'sv1', partOneVersionId: 'v1', status: 'published', rubrics: [{ ...rubrics[0] }, { ...rubrics[1] }, { id: rubrics[2].id, name: rubrics[2].name, mode: 'fixed', fixedMinor: 1000 }] }];
    const rows = calculateAllocationForecast(data).rows;
    expect(table(rows, 1)).toEqual(one);
    // 40 % et 20 % de 40 USD = 16 et 8 ; 10 USD fixes ; reste 6 USD non affecté.
    expect(table(rows, 2)).toEqual({ [rubric(1)]: 1600, [rubric(2)]: 800, [rubric(3)]: 1000, UNALLOCATED: 600 });
    expect(rows.find(r => r.table === 2 && r.rubricId === rubric(3))).toMatchObject({ rubricMode: 'fixed', rubricShare: 1000 });
  });
});
