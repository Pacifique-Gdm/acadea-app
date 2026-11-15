import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// Refresh only the already-authorized local gcloud identity. No login, key
// file, IAM change or impersonation is performed by a recipe.
export function stagingOAuthProvider({ env = process.env, now = Date.now, run = exec } = {}) {
  let cached, pending;
  return async () => {
    if (env.GOOGLE_CLOUD_PROJECT !== 'acadea-staging' || env.GOOGLE_CLOUD_QUOTA_PROJECT !== 'acadea-staging') throw Error('OAuth réservé à acadea-staging.');
    if (cached && cached.expiry_date - now() > 30000) return cached;
    if (pending) return pending;
    pending = (async () => {
      let token = env.ACADEA_STAGING_ACCESS_TOKEN;
      if (env.ACADEA_STAGING_GCLOUD_AUTH === 'YES') {
        try {
          const result = await run(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', ['auth', 'print-access-token'], {
            shell: process.platform === 'win32', windowsHide: true, encoding: 'utf8', timeout: 45000,
          });
          token = result.stdout.trim();
        } catch { throw Error('Renouvellement officiel Google Cloud indisponible ; aucune valeur sensible journalisée.'); }
      }
      if (!token) throw Error('Accès OAuth Staging absent.');
      cached = { access_token: token, expiry_date: now() + 120000 };
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
