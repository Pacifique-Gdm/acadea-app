import { describe, expect, it, vi } from 'vitest';
import { guardedRoute, redactRecipeError } from '../../scripts/hostedRecipeSafety.mjs';
describe('confidentialité et clôture des recettes', () => {
  it('absorbe les erreurs de transport de callback sans exposer les en-têtes', async () => {
    const failures = [], abort = vi.fn().mockResolvedValue(undefined);
    await expect(guardedRoute(async () => { throw Error('Authorization: Bearer fictif-secret'); }, failures)({ abort })).resolves.toBeUndefined();
    expect(abort).toHaveBeenCalledWith('connectionfailed');
    expect(failures).toHaveLength(1); expect(JSON.stringify(failures)).not.toContain('secret');
  });
  it('masque aussi un jeton renouvelé par le navigateur, absent du registre API', () => {
    const text = redactRecipeError(Error('Bearer opaque-value; refreshed eyJheader.payload.signature password'), ['password']);
    expect(text).not.toContain('opaque-value'); expect(text).not.toContain('eyJheader'); expect(text).not.toContain('password');
  });
});
