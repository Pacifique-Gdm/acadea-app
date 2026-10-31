import { describe, it, expect, vi } from 'vitest';
import { manageSectionAdministrators } from './manageSectionAdministrators.js';
function setup() {
  const profile = { role: 'primary_admin', schoolId: 'school-a', sectionIds: ['Primaire'], status: 'inactive', active: false };
  const db = { doc: (path: string) => ({ path, get: async () => ({ exists: true, data: () => path === 'users/root' ? { role: 'super_admin' } : profile }) }), collection: () => ({ doc: () => ({ id: 'audit' }) }), runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(tx)) };
  const tx = { get: async (ref: { get: () => Promise<unknown> }) => ref.get(), update: vi.fn(), create: vi.fn() };
  const auth = { updateUser: vi.fn().mockResolvedValue({}), revokeRefreshTokens: vi.fn().mockResolvedValue(undefined), deleteUser: vi.fn().mockResolvedValue(undefined) };
  return { db, auth, tx, caller: { uid: 'root', role: 'super_admin' }, body: { schoolId: 'school-a', userId: 'target', operation: 'deactivate', confirmation: 'DÉSACTIVER CET UTILISATEUR' } };
}
describe('section administrator lifecycle', () => {
  it('disables access, revokes tokens and records the operation', async () => {
    const input = setup(); await manageSectionAdministrators(input);
    expect(input.auth.updateUser).toHaveBeenCalledWith('target', { disabled: true });
    expect(input.auth.revokeRefreshTokens).toHaveBeenCalledWith('target');
    expect(input.tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ active: false, status: 'inactive' }));
    expect(input.tx.create).toHaveBeenCalledOnce();
  });
  it('removes auth access while retaining a historical tombstone', async () => {
    const input = setup(); input.body.operation = 'delete'; input.body.confirmation = 'SUPPRIMER CET UTILISATEUR';
    await manageSectionAdministrators(input);
    expect(input.auth.deleteUser).toHaveBeenCalledWith('target');
    expect(input.tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deletedBy: 'root', active: false }));
  });
  it.each(['school_admin', 'primary_admin', 'parent'])('denies lifecycle operations to %s', async role => {
    const input = setup(); input.caller.role = role;
    await expect(manageSectionAdministrators(input)).rejects.toMatchObject({ statusCode: 403 });
    expect(input.auth.updateUser).not.toHaveBeenCalled();
  });
  it('rejects a target belonging to another school', async () => {
    const input = setup(); input.body.schoolId = 'school-b';
    await expect(manageSectionAdministrators(input)).rejects.toThrow(/Profil introuvable/);
    expect(input.auth.updateUser).not.toHaveBeenCalled();
  });
  it('rejects approximate confirmation without side effects', async () => {
    const input = setup(); input.body.confirmation += ' ';
    await expect(manageSectionAdministrators(input)).rejects.toThrow(/Confirmation exacte/);
    expect(input.auth.updateUser).not.toHaveBeenCalled();
  });
  it('keeps activation blocked even with exact confirmation', async () => {
    const input = setup(); input.body.operation = 'activate'; input.body.confirmation = 'ACTIVER CET UTILISATEUR';
    await expect(manageSectionAdministrators(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(input.auth.updateUser).not.toHaveBeenCalled();
  });
});
