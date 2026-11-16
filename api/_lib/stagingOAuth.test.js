import { describe, expect, it, vi } from 'vitest';
import { stagingOAuthProvider } from '../../scripts/stagingOAuth.mjs';
const env = { GOOGLE_CLOUD_PROJECT: 'acadea-staging', GOOGLE_CLOUD_QUOTA_PROJECT: 'acadea-staging', ACADEA_STAGING_GCLOUD_AUTH: 'YES' };
describe('Staging OAuth lifecycle', () => {
  it('refreshes the official identity and shares concurrent refreshes without logging credentials', async () => {
    let time = 0;
    const run = vi.fn().mockResolvedValueOnce({ stdout: 'synthetic-first\n' }).mockResolvedValueOnce({ stdout: 'synthetic-renewed\n' });
    const token = stagingOAuthProvider({ env, now: () => time, run, inspect: vi.fn().mockResolvedValue(3600) });
    const first = await Promise.all([token(), token()]);
    expect(run).toHaveBeenCalledTimes(1); expect(first[0]).toEqual(first[1]);
    time = 100000;
    expect((await token()).access_token).toBe('synthetic-first'); expect(run).toHaveBeenCalledTimes(1);
    time = 55 * 60000;
    expect((await token()).access_token).toBe('synthetic-renewed'); expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][1]).toEqual(['auth', 'print-access-token']);
  });
  it('never invokes gcloud against another project or without explicit opt-in', async () => {
    const run = vi.fn();
    await expect(stagingOAuthProvider({ env: { ...env, GOOGLE_CLOUD_PROJECT: 'acadea-production' }, run })()).rejects.toThrow('réservé');
    const token = stagingOAuthProvider({ env: { ...env, ACADEA_STAGING_GCLOUD_AUTH: undefined, ACADEA_STAGING_ACCESS_TOKEN: 'synthetic-ci' }, run, inspect: async () => 3600 });
    expect((await token()).access_token).toBe('synthetic-ci'); expect(run).not.toHaveBeenCalled();
  });
  it('uses the supplied official credential once and respects its actual remaining lifetime', async () => {
    let time = 0;
    const run = vi.fn().mockResolvedValue({ stdout: 'synthetic-refreshed' });
    const inspect = vi.fn().mockResolvedValueOnce(120).mockResolvedValueOnce(3600);
    const token = stagingOAuthProvider({ env: { ...env, ACADEA_STAGING_ACCESS_TOKEN: 'synthetic-initial' }, now: () => time, run, inspect });
    expect((await token()).expiry_date).toBe(90000); expect(run).not.toHaveBeenCalled();
    time = 61000;
    expect((await token()).access_token).toBe('synthetic-refreshed'); expect(run).toHaveBeenCalledTimes(1);
  });
  it('fails closed without disclosing credentials when token validation fails', async () => {
    const supplied = { ...env, ACADEA_STAGING_ACCESS_TOKEN: 'synthetic-private' };
    await expect(stagingOAuthProvider({ env: supplied, inspect: async () => { throw Error('synthetic-private'); } })()).rejects.toThrow('Vérification officielle');
    for (const remaining of [0, 60, Number.NaN]) {
      await expect(stagingOAuthProvider({ env: supplied, inspect: async () => remaining })()).rejects.toThrow('expiré');
    }
  });
  it('does not disclose a failed credential command output', async () => {
    const run = vi.fn().mockRejectedValue(new Error('synthetic-sensitive-output'));
    await expect(stagingOAuthProvider({ env, run })()).rejects.toThrow('Renouvellement officiel');
    await expect(stagingOAuthProvider({ env, run })()).rejects.not.toThrow('synthetic-sensitive-output');
  });
});
