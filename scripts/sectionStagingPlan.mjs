import { randomUUID } from 'node:crypto';
import { studentForPersistence } from '../src/utils/studentYearTransition.js';

export const sections = ['Maternelle', 'Primaire', 'CTEB', 'Secondaire'];
export const roles = { kindergarten_admin: ['Maternelle'], primary_admin: ['Primaire'], studies_prefect: ['CTEB', 'Secondaire'] };
export function guard(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== 'Pacifique-Gdm/acadea-app'
    || env.GITHUB_REF !== 'refs/heads/codex/section-admin-profiles-final-20261031'
    || env.GOOGLE_CLOUD_PROJECT !== 'acadea-staging' || env.ACADEA_SECTION_RECIPE_AUTHORIZED !== 'YES'
    || !/^[a-f0-9]{40}$/.test(env.ACADEA_EXPECTED_SHA || '')
    || ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_SERVICE_ACCOUNT_JSON'].some(k => env[k])) throw new Error('Recette Staging non autorisée ou cible invalide.');
  const url = new URL(env.ACADEA_SECTION_PREVIEW_URL);
  if (url.protocol !== 'https:' || !/^acadea-staging-[a-z0-9-]+\.vercel\.app$/.test(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Preview Staging isolé obligatoire.');
  if (!['acadea-staging.firebasestorage.app', 'acadea-staging.appspot.com'].includes(env.STAGING_FIREBASE_STORAGE_BUCKET)) throw new Error('Bucket Staging invalide.');
}
export function plan(tag = `e2e-section-${randomUUID().replaceAll('-', '')}`) {
  if (!/^e2e-section-[a-f0-9]{32}$/.test(tag)) throw new Error('Identifiant de fixture invalide.');
  const schools = [`${tag}-a`, `${tag}-b`], years = schools.map(s => `${s}-year`);
  const documents = [], users = {};
  const add = (collection, id, data) => documents.push({ path: `${collection}/${id}`, data: { ...data, id, fixtureId: tag } });
  for (let s = 0; s < 2; s++) {
    const schoolId = schools[s], schoolYearId = years[s];
    add('schools', schoolId, { name: `École fictive B08 ${s}`, status: 'active', currency: 'CDF', educationLevels: sections, schoolOptions: ['Sciences'], activeSchoolYearId: schoolYearId, subscriptionStatus: 'active', subscriptionPlan: 'premium' });
    add('schoolYears', schoolYearId, { schoolId, name: '2026-2027', status: 'active', currency: 'CDF', startsAt: '2026-09-01', endsAt: '2027-07-31' });
    for (const [i, section] of sections.entries()) {
      const classId = `${schoolId}-class-${i}`, studentId = `${schoolId}-student-${i}`;
      const className = ['Maternelle 1', '1ère Primaire', '7ème CTEB', '1ère Humanité'][i];
      add('classes', classId, { schoolId, schoolYearId, name: className, section, active: true });
      add('students', studentId, studentForPersistence({ id: studentId, schoolId, schoolYearId, classId, className, section, nom: `FICTIF${s}${i}`, postnom: 'RECETTE', prenom: 'Test', matricule: `${s}-${i}`, sexe: 'F', birthDate: '2015-01-02', status: 'ACTIVE', parentId: `${schoolId}-parent` }));
      add('payments', `${schoolId}-payment-${i}`, { schoolId, schoolYearId, section, studentId, parentId: `${schoolId}-parent`, feeTypeId: `${schoolId}-fee`, feeName: 'Minerval', amount: (i + 1) * 100, currency: 'CDF', paidAt: '2026-10-01', createdAt: '2026-10-01T12:00:00.000Z', receiptNumber: `FICTIF-${i}` });
    }
    add('feeTypes', `${schoolId}-fee`, { schoolId, schoolYearId, name: 'Minerval', amount: 10000, currency: 'CDF', active: true });
    add('parents', `${schoolId}-parent`, { schoolId, name: 'Parent multi-sections fictif', userId: `${schoolId}-parent-user`, studentIds: sections.map((_, i) => `${schoolId}-student-${i}`), status: 'active', active: true });
    add('expenses', `${schoolId}-expense`, { schoolId, schoolYearId, amount: 100, currency: 'CDF', category: 'Fournitures', description: 'Dépense fictive', createdAt: '2026-10-01T12:00:00.000Z', spentAt: '2026-10-01' });
    add('cashInflows', `${schoolId}-inflow`, { schoolId, schoolYearId, amount: 1000, currency: 'CDF', category: 'Don', description: 'Recette fictive', createdAt: '2026-10-01T12:00:00.000Z', entryDate: '2026-10-01' });
    add('personnelPayments', `${schoolId}-payroll`, { schoolId, schoolYearId, beneficiaryId: `${schoolId}-teacher`, beneficiaryName: 'Enseignant fictif', kind: 'salary', amount: 100, netPaid: 100, currency: 'CDF', expenseId: `${schoolId}-expense`, paidAt: '2026-10-01', createdAt: '2026-10-01T12:00:00.000Z', description: 'Paie fictive globale' });
    const accountRoles = s === 0 ? [...Object.keys(roles), 'parent', 'secretary', 'teacher'] : ['parent', 'primary_admin'];
    for (const role of accountRoles) {
      const key = `${s}-${role}`, uid = role === 'parent' ? `${schoolId}-parent-user` : `${schoolId}-${role}`;
      users[key] = { uid, email: `${uid}@example.invalid`, role, schoolId, ...(role === 'parent' ? { parentId: `${schoolId}-parent` } : {}) };
      add('users', uid, { ...users[key], name: `Compte fictif ${role}`, status: roles[role] ? 'inactive' : 'active', active: !roles[role], activeSchoolYearId: schoolYearId, ...(roles[role] ? { sectionIds: roles[role] } : {}) });
    }
  }
  const uid = `${tag}-super-admin`;
  users.super_admin = { uid, email: `${uid}@example.invalid`, role: 'super_admin' };
  add('users', uid, { ...users.super_admin, name: 'Super Administrateur fictif', status: 'active', active: true });
  return { projectId: 'acadea-staging', tag, schools, years, users, documents, createdPaths: [], createdUsers: [] };
}
export function assertOwned(manifest, path, data) {
  if (!data || !(data.fixtureId === manifest.tag || manifest.schools.includes(data.schoolId))
    || (path.startsWith('schools/') && !manifest.schools.includes(path.split('/')[1]))) throw new Error('Nettoyage interrompu : document non attribuable à la fixture.');
}
