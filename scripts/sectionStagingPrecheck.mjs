import { guard } from './sectionStagingPlan.mjs';
guard(process.env);
const origin = process.env.ACADEA_SECTION_PREVIEW_URL;
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
async function get(path) {
  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin) throw new Error('Ressource hors Preview.');
  const r = await fetch(url, { headers, redirect: 'error' });
  if (!r.ok) throw new Error(`Preview inaccessible (${r.status}).`);
  return r;
}
if ((await (await get('/version.json')).json()).version !== process.env.ACADEA_EXPECTED_SHA) throw new Error('SHA Preview incorrect.');
const assets = await (await get('/offline-assets.json')).json();
if (assets.version !== process.env.ACADEA_EXPECTED_SHA || !Array.isArray(assets.assets)) throw new Error('Manifeste assets incorrect.');
let configuration = false;
for (const path of assets.assets.filter(p => /^\/assets\/[^/]+\.js$/.test(p))) {
  const text = await (await get(path)).text();
  if (/projectId\s*:\s*["']acadea-production["']/.test(text)) throw new Error('Configuration Production détectée.');
  if (/projectId\s*:\s*["']acadea-staging["']/.test(text)
    && /authDomain\s*:\s*["']acadea-staging\.firebaseapp\.com["']/.test(text)) configuration = true;
}
if (!configuration) throw new Error('Configuration Firebase du bundle non démontrée.');
console.log('SHA et configuration publique Staging concordants. Aucune donnée créée.');
