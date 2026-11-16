import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

async function inspectToken(token) {
  // Google's official token-info endpoint accepts the credential in a header,
  // never in a URL, command line or persisted file. Use its real remaining TTL.
  const response = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error('Vérification officielle du jeton indisponible.');
  const body = await response.json();
  return Number(body.expires_in);
}

// Refresh only the already-authorized local gcloud identity. No login, key
// file, IAM change or impersonation is performed by a recipe.
export function stagingOAuthProvider({ env = process.env, now = Date.now, run = exec, inspect = inspectToken } = {}) {
  let cached, pending;
  let initial = env.ACADEA_STAGING_ACCESS_TOKEN;
  return async () => {
    if (env.GOOGLE_CLOUD_PROJECT !== 'acadea-staging' || env.GOOGLE_CLOUD_QUOTA_PROJECT !== 'acadea-staging') throw Error('OAuth réservé à acadea-staging.');
    if (cached && cached.expiry_date - now() > 30000) return cached;
    if (pending) return pending;
    pending = (async () => {
      let token = initial;
      initial = undefined;
      if (!token && env.ACADEA_STAGING_GCLOUD_AUTH === 'YES') {
        try {
          const result = await run(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', ['auth', 'print-access-token'], {
            shell: process.platform === 'win32', windowsHide: true, encoding: 'utf8', timeout: 120000,
          });
          token = result.stdout.trim();
        } catch { throw Error('Renouvellement officiel Google Cloud indisponible ; aucune valeur sensible journalisée.'); }
      }
      if (!token) throw Error('Accès OAuth Staging absent.');
      let remainingSeconds;
      try { remainingSeconds = await inspect(token); }
      catch { throw Error('Vérification officielle du jeton indisponible ; aucune valeur sensible journalisée.'); }
      if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 60) throw Error('Jeton Staging expiré ou trop proche de son expiration.');
      cached = { access_token: token, expiry_date: now() + Math.min(remainingSeconds * 1000, 55 * 60000) - 30000 };
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
