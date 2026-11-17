#!/usr/bin/env node
// À lancer DANS chaque PR, avant de demander la mise en production :
//   node scripts/release/version-bump.mjs <correction|fonctionnalite|majeur> "Changement 1" ["Changement 2" ...]
// Met à jour package.json, package-lock.json et ajoute la section en tête de CHANGELOG.md.
import { readFileSync, writeFileSync } from "node:fs";
import { addChangelogEntry, nextVersion, RELEASE_TYPES } from "./versioning.mjs";

const [type, ...changes] = process.argv.slice(2);
if (!RELEASE_TYPES[type] || !changes.length) {
  console.error('Usage : node scripts/release/version-bump.mjs <correction|fonctionnalite|majeur> "Changement 1" ["Changement 2" ...]');
  process.exit(1);
}
const writeJson = (path, update) => {
  const raw = readFileSync(path, "utf8"); const json = JSON.parse(raw); update(json);
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(path, JSON.stringify(json, null, 2).replace(/\n/g, eol) + eol);
};
const current = JSON.parse(readFileSync("package.json", "utf8")).version;
const version = nextVersion(current, type);
writeJson("package.json", (json) => { json.version = version; });
writeJson("package-lock.json", (json) => { json.version = version; if (json.packages?.[""]) json.packages[""].version = version; });
const date = new Date().toISOString().slice(0, 10);
const changelog = readFileSync("CHANGELOG.md", "utf8");
writeFileSync("CHANGELOG.md", addChangelogEntry(changelog, { version, type, date, changes }));
console.log(`Version ${current} → ${version} (${RELEASE_TYPES[type]}). CHANGELOG.md complété.`);
