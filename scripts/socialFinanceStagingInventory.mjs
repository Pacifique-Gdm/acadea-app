import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const project = 'acadea-staging';
if (process.env.GOOGLE_CLOUD_PROJECT !== project || !process.env.ACADEA_STAGING_ACCESS_TOKEN) throw Error('Staging explicite requis');
const headers = { Authorization: `Bearer ${process.env.ACADEA_STAGING_ACCESS_TOKEN}`, 'x-goog-user-project': project };
const folder = `diagnostics/social-finance-staging/backup-${Date.now()}`;
mkdirSync(folder, { recursive: true });
async function get(url) {
  const r = await fetch(url, { headers });
  if (!r.ok) throw Error(`Inventaire indisponible: HTTP ${r.status} (${new URL(url).hostname})`);
  return r.json();
}
const releases = await get(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`);
writeFileSync(`${folder}/releases.json`, JSON.stringify(releases, null, 2));
for (const release of releases.releases || []) {
  const rules = await get(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  const label = release.name.includes('storage') ? 'storage' : 'firestore';
  writeFileSync(`${folder}/${label}.json`, JSON.stringify(rules, null, 2));
  for (const file of rules.source?.files || []) {
    const candidate = readFileSync(`${label}.rules`, 'utf8');
    const digest = s => createHash('sha256').update(s.replaceAll('\r\n', '\n').trim()).digest('hex');
    console.log(JSON.stringify({ component: label, ruleset: release.rulesetName, candidateMatches: digest(candidate) === digest(file.content) }));
  }
}
for (const [name, url] of [
  ['indexes', `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/indexes`],
  ['functions', `https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/-/functions`],
]) {
  const data = await get(url);
  // Function configuration may contain secrets: never persist environment variables.
  const safe = name === 'functions' ? (data.functions || []).map(f => ({ name: f.name, state: f.state, updateTime: f.updateTime, build: f.buildConfig?.build, source: f.buildConfig?.source })) : data;
  writeFileSync(`${folder}/${name}.json`, JSON.stringify(safe, null, 2));
  console.log(JSON.stringify({ component: name, items: name === 'functions' ? safe : (data.indexes || []).map(i => ({ name: i.name, state: i.state })), more: Boolean(data.nextPageToken) }));
}
console.log(`Sauvegarde locale : ${folder}`);
