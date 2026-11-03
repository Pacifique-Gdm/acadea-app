import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const project = 'acadea-staging';
const folder = process.argv[2];
if (process.env.GOOGLE_CLOUD_PROJECT !== project || process.env.ACADEA_PUBLISH_STAGING_RULES !== 'YES'
  || !process.env.ACADEA_STAGING_ACCESS_TOKEN || !/^diagnostics\/social-finance-staging\/backup-\d+$/.test(folder || '')) throw Error('Publication Staging explicite et sauvegarde requises');
const expected = process.env.ACADEA_EXPECTED_SHA;
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (sha !== expected || !/^[a-f0-9]{40}$/.test(expected || '')) throw Error('SHA inattendu');
for (const file of ['firestore.rules', 'storage.rules']) {
  const committed = execFileSync('git', ['show', `${sha}:${file}`], { encoding: 'utf8' });
  if (committed.replaceAll('\r\n', '\n') !== readFileSync(file, 'utf8').replaceAll('\r\n', '\n')) throw Error('Règles non commitées');
}
const headers = { Authorization: `Bearer ${process.env.ACADEA_STAGING_ACCESS_TOKEN}`, 'x-goog-user-project': project, 'Content-Type': 'application/json' };
async function api(path, method = 'GET', body) {
  if (!path.startsWith(`projects/${project}/`)) throw Error('Ressource étrangère');
  const r = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!r.ok) throw Error(`Rules API ${method}: HTTP ${r.status}`);
  return r.json();
}
const releases = JSON.parse(readFileSync(`${folder}/releases.json`, 'utf8')).releases;
const plan = [];
for (const component of ['firestore', 'storage']) {
  const release = releases.find(r => component === 'storage' ? r.name.includes('firebase.storage/') : r.name.endsWith('/cloud.firestore'));
  if (!release) throw Error('Release sauvegardée absente');
  const live = await api(release.name);
  if (live.rulesetName !== release.rulesetName) throw Error('Ruleset distant changé depuis la sauvegarde');
  const ruleset = await api(`projects/${project}/rulesets`, 'POST', { source: { files: [{ name: `${component}.rules`, content: readFileSync(`${component}.rules`, 'utf8') }] } });
  plan.push({ component, release: release.name, previous: release.rulesetName, candidate: ruleset.name });
}
writeFileSync(`${folder}/publication-plan.json`, JSON.stringify({ sha, plan }, null, 2));
for (const entry of plan) {
  await api(entry.release, 'PATCH', { release: { name: entry.release, rulesetName: entry.candidate }, updateMask: 'rulesetName' });
  const active = await api(entry.release);
  if (active.rulesetName !== entry.candidate) throw Error('Publication non confirmée');
  console.log(JSON.stringify({ component: entry.component, ruleset: active.rulesetName, sha }));
}
