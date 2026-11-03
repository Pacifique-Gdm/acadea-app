import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const folder = process.argv[2];
if (!/^diagnostics\/social-finance-staging\/backup-\d+$/.test(folder || '')) throw Error('Sauvegarde locale attendue');
for (const name of ['firestore', 'storage']) {
  const data = JSON.parse(readFileSync(`${folder}/${name}.json`, 'utf8'));
  if (!data.name.startsWith('projects/acadea-staging/rulesets/')) throw Error('Projet inattendu');
  writeFileSync(`${folder}/${name}.rules`, data.source.files[0].content);
  const diff = spawnSync('git', ['diff', '--no-index', '--', `${folder}/${name}.rules`, `${name}.rules`], { encoding: 'utf8' });
  process.stdout.write(diff.stdout || '');
}
