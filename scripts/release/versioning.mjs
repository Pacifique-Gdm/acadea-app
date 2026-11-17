// Numéro de version et liste des changements d'Acadéa (décision du propriétaire, 17/11/2026).
// Règle : dernier chiffre = correction, chiffre du milieu = fonctionnalité, premier chiffre = grand changement.
// Utilisé par scripts/release/version-bump.mjs (dans chaque PR), scripts/release/check-version.mjs
// (contrôle GitHub) et scripts/release/ship-lot.sh (mise en production).

export const RELEASE_TYPES = { correction: "Correction", fonctionnalite: "Fonctionnalité", majeur: "Grand changement" };

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim());
  if (!match) throw new Error(`Numéro de version invalide : « ${value} » (format attendu : 1.2.3).`);
  return match.slice(1).map(Number);
}

export function nextVersion(current, type) {
  const [major, minor, patch] = parseVersion(current);
  if (type === "majeur") return `${major + 1}.0.0`;
  if (type === "fonctionnalite") return `${major}.${minor + 1}.0`;
  if (type === "correction") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Type de lot inconnu : « ${type} » (correction, fonctionnalite ou majeur).`);
}

export function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

/** Le passage de `base` à `head` doit suivre exactement une des trois règles. */
export function releaseTypeBetween(base, head) {
  for (const type of Object.keys(RELEASE_TYPES)) if (nextVersion(base, type) === head) return type;
  return null;
}

export function changelogEntry(changelog, version) {
  const lines = String(changelog ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## ["));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => /^\s*-\s+\S/.test(line));
  return { title: lines[start], changes: body.map((line) => line.replace(/^\s*-\s+/, "").trim()) };
}

export function addChangelogEntry(changelog, { version, type, date, changes }) {
  if (!changes.length || changes.some((change) => !String(change).trim())) throw new Error("Décrivez au moins un changement.");
  if (changelogEntry(changelog, version)) throw new Error(`La version ${version} figure déjà dans CHANGELOG.md.`);
  const entry = [`## [${version}] — ${date} — ${RELEASE_TYPES[type]}`, ...changes.map((change) => `- ${String(change).trim()}`), ""].join("\n");
  const text = String(changelog ?? "");
  const marker = text.indexOf("\n## [");
  if (marker < 0) return `${text.trimEnd()}\n\n${entry}`;
  return `${text.slice(0, marker + 1)}${entry}\n${text.slice(marker + 1)}`;
}

/** Contrôle d'une PR : numéro augmenté selon la règle, et liste des changements complétée. */
export function checkRelease({ baseVersion, headVersion, changelog }) {
  const problems = [];
  let type = null;
  try {
    if (compareVersions(headVersion, baseVersion) <= 0) problems.push(`Le numéro de version n'a pas été augmenté (main : ${baseVersion}, PR : ${headVersion}).`);
    else if (!(type = releaseTypeBetween(baseVersion, headVersion))) problems.push(`Le numéro ${headVersion} ne suit pas la règle depuis ${baseVersion} (attendu : ${nextVersion(baseVersion, "correction")}, ${nextVersion(baseVersion, "fonctionnalite")} ou ${nextVersion(baseVersion, "majeur")}).`);
  } catch (error) { problems.push(error.message); }
  const entry = changelogEntry(changelog, headVersion);
  if (!entry) problems.push(`CHANGELOG.md ne contient pas la section « ## [${headVersion}] ».`);
  else if (!entry.changes.length) problems.push(`La section ${headVersion} de CHANGELOG.md ne liste aucun changement.`);
  return { ok: problems.length === 0, type, problems, entry };
}
