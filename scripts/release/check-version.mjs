#!/usr/bin/env node
// Contrôle GitHub (et local) : refuse une PR si le numéro de version n'a pas été augmenté selon la règle
// ou si CHANGELOG.md n'a pas la section complétée.
//   node scripts/release/check-version.mjs [branche de base, par défaut origin/main]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkRelease } from "./versioning.mjs";

const base = process.argv[2] ?? "origin/main";
const baseVersion = JSON.parse(execFileSync("git", ["show", `${base}:package.json`], { encoding: "utf8" })).version;
const headVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const result = checkRelease({ baseVersion, headVersion, changelog: readFileSync("CHANGELOG.md", "utf8") });
if (!result.ok) {
  console.error("Contrôle de version refusé :");
  for (const problem of result.problems) console.error(`- ${problem}`);
  console.error('Solution : node scripts/release/version-bump.mjs <correction|fonctionnalite|majeur> "Description du changement"');
  process.exit(1);
}
console.log(`Contrôle de version OK : ${baseVersion} → ${headVersion} (${result.type}), ${result.entry.changes.length} changement(s) listé(s).`);
