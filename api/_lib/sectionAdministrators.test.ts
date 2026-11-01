import { describe, expect, it } from 'vitest';
import { SECTION_ADMINISTRATORS, SECTION_ADMIN_CONFIRMATIONS, sectionAdministratorScope, requireActiveSectionAdministratorActor, requireSectionAdministratorResource, requireSectionAdministratorMutation, requireSectionAdministratorConfirmation } from './sectionAdministrators.js';
const profile = { role: 'primary_admin', status: 'active', schoolId: 'school-a', sectionIds: ['Primaire'] };
describe('section administrator authorization boundaries', () => {
  it.each(Object.keys(SECTION_ADMINISTRATORS))('accepts the active assigned profile %s', role => {
    expect(sectionAdministratorScope({ ...profile, role })).toMatchObject({ schoolId: 'school-a' });
  });
  it.each([undefined, [], ['unknown'], ['Primaire', 'unknown']])('rejects invalid assignment %j', sectionIds => {
    expect(() => sectionAdministratorScope({ ...profile, sectionIds })).toThrow();
  });
  it.each([{ status: 'inactive' }, { active: false }, { schoolId: '' }, { role: 'school_admin' }])('rejects invalid profile %j', patch => {
    expect(() => sectionAdministratorScope({ ...profile, ...patch })).toThrow();
  });
  it('allows only explicitly assigned sections in the same school', () => {
    for (const section of ['Maternelle', 'Primaire', 'CTEB', 'Secondaire']) {
      const resource = { schoolId: 'school-a', section };
      if (section === 'Primaire') expect(requireSectionAdministratorResource(profile, resource)).toBe(resource);
      else expect(() => requireSectionAdministratorResource(profile, resource)).toThrow();
      expect(() => requireSectionAdministratorResource(profile, { ...resource, schoolId: 'school-b' })).toThrow();
    }
    expect(() => requireSectionAdministratorResource(profile, { schoolId: 'school-a' })).toThrow();
  });
  it('supports multiple sections without allowing a different tenant', () => {
    const multi = { ...profile, sectionIds: ['CTEB', 'Secondaire'] };
    for (const section of multi.sectionIds) expect(() => requireSectionAdministratorResource(multi, { schoolId: 'school-a', section })).not.toThrow();
    expect(() => requireSectionAdministratorResource(multi, { schoolId: 'school-b', section: 'CTEB' })).toThrow();
  });
  it('checks both old and new scopes during edits', () => {
    const own = { schoolId: 'school-a', section: 'Primaire' };
    const foreign = { schoolId: 'school-b', section: 'Primaire' };
    expect(() => requireSectionAdministratorMutation(profile, own, own)).not.toThrow();
    expect(() => requireSectionAdministratorMutation(profile, own, foreign)).toThrow();
    expect(() => requireSectionAdministratorMutation(profile, foreign, own)).toThrow();
  });
  it.each(Object.entries(SECTION_ADMIN_CONFIRMATIONS))('requires the exact %s confirmation', (action, confirmation) => {
    expect(() => requireSectionAdministratorConfirmation(action, confirmation)).not.toThrow();
    for (const value of ['', confirmation.toLowerCase(), ` ${confirmation}`, `${confirmation} `]) expect(() => requireSectionAdministratorConfirmation(action, value)).toThrow();
  });
  it('rejects unknown management actions', () => expect(() => requireSectionAdministratorConfirmation('toString', '')).toThrow());
  it('re-reads active role, school and sections before granting a financial view', async () => {
    let record = { ...profile };
    const db = { doc: () => ({ get: async () => ({ exists: true, data: () => record }) }) };
    const caller = { uid: 'admin-a', role: 'primary_admin', schoolId: 'school-a' };
    await expect(requireActiveSectionAdministratorActor(db, caller)).resolves.toMatchObject({ schoolId: 'school-a', sectionIds: ['Primaire'] });
    record = { ...record, status: 'inactive' };
    await expect(requireActiveSectionAdministratorActor(db, caller)).rejects.toMatchObject({ statusCode: 403 });
    record = { ...profile };
    await expect(requireActiveSectionAdministratorActor(db, { ...caller, schoolId: 'school-b' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireActiveSectionAdministratorActor(db, { ...caller, role: 'school_admin' })).rejects.toMatchObject({ statusCode: 403 });
  });
});
