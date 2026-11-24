#!/usr/bin/env bash
# Mise en production d'Acadéa — procédure UNIQUE pour tous les agents (Claude Code, Codex) et les humains.
# Usage : bash scripts/release/ship-lot.sh <numéro de PR>
#
# Avant : dans la PR, lancer `node scripts/release/version-bump.mjs <correction|fonctionnalite|majeur> "Changement"`
# (numéro augmenté selon la règle + section ajoutée à CHANGELOG.md). Le contrôle GitHub « version-check » le vérifie.
#
# Étapes : contrôles GitHub tous verts → version et CHANGELOG vérifiés → fusion → construction de production
# (sans domaine) → 9 vérifications → mise en ligne (vercel promote) → 9 vérifications sur le site en ligne →
# journal. Arrêt (code 1) au moindre échec ; rien n'est mis en ligne avant les 9 vérifications réussies.
#
# Variables : ACADEA_DEPLOY_DIR = dossier de déploiement (clone propre de main, lié au projet Vercel acadea-app) ;
#             ACADEA_JOURNAL    = journal local facultatif (en plus de CHANGELOG.md, versionné).
set -u
PR="${1:-}"; REPO="Pacifique-Gdm/acadea-app"
DEPLOY="${ACADEA_DEPLOY_DIR:-C:/Users/Pacifique BILOMBI/Documents/AC-production-deploy}"
stop() { echo "ARRÊT : $1"; exit 1; }
[ -n "$PR" ] || stop "numéro de PR manquant (bash scripts/release/ship-lot.sh <PR>)"
git -C "$DEPLOY" rev-parse --git-dir >/dev/null 2>&1 || stop "dossier de déploiement introuvable : $DEPLOY (variable ACADEA_DEPLOY_DIR)"

# 1. Contrôles GitHub (dont version-check).
sleep 20
gh pr checks "$PR" --repo "$REPO" --watch --interval 30 >/dev/null 2>&1
checks=$(gh pr checks "$PR" --repo "$REPO" 2>&1); echo "$checks" | awk -F'\t' '{print "  " $1 ": " $2}'
echo "$checks" | grep -q "version-check" || stop "contrôle version-check absent de la PR"
echo "$checks" | awk -F'\t' '$2!="pass" && $2!="skipping" {bad=1} END {exit bad}' || stop "contrôle non vert"

# 2. Version et liste des changements de la PR (même règle que le contrôle GitHub).
BR=$(gh pr view "$PR" --repo "$REPO" --json headRefName --jq .headRefName) || stop "branche de la PR introuvable"
git -C "$DEPLOY" fetch -q origin main "$BR" || stop "récupération des branches"
NEWV=$(git -C "$DEPLOY" show "origin/$BR:package.json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).version))')
BASEV=$(git -C "$DEPLOY" show origin/main:package.json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).version))')
CHANGES=$(git -C "$DEPLOY" show "origin/$BR:CHANGELOG.md" 2>/dev/null) || stop "CHANGELOG.md absent de la PR"
VERDICT=$(cd "$DEPLOY" && git show "origin/$BR:scripts/release/versioning.mjs" > .release-versioning.tmp.mjs && printf '%s' "$CHANGES" | node --input-type=module -e '
  import { checkRelease } from "./.release-versioning.tmp.mjs";
  let changelog = ""; process.stdin.on("data", (c) => changelog += c).on("end", () => {
    const r = checkRelease({ baseVersion: process.argv[1], headVersion: process.argv[2], changelog });
    console.log(r.ok ? `OK ${r.type}` : `KO ${r.problems.join(" / ")}`); });' "$BASEV" "$NEWV"; rm -f .release-versioning.tmp.mjs)
case "$VERDICT" in OK*) echo "  version : $BASEV → $NEWV (${VERDICT#OK })";; *) stop "version ou CHANGELOG non conformes : ${VERDICT#KO }";; esac

# 3. Fusion.
state=$(gh pr view "$PR" --repo "$REPO" --json mergeable,mergeStateStatus --jq '.mergeable + " " + .mergeStateStatus'); echo "  fusion possible : $state"
[ "$state" = "MERGEABLE CLEAN" ] || stop "fusion non propre ($state) — mettre la branche à jour avec main puis relancer"
gh pr merge "$PR" --repo "$REPO" --merge >/dev/null 2>&1 || stop "fusion refusée"
SHA=$(gh pr view "$PR" --repo "$REPO" --json mergeCommit --jq .mergeCommit.oid); [ -n "$SHA" ] || stop "commit de fusion introuvable"
echo "  fusionnée : $SHA"

# 4. Construction et vérifications AVANT la mise en ligne.
PREV=$(cd "$DEPLOY" && MSYS_NO_PATHCONV=1 timeout 90 vercel inspect acadea-app.vercel.app --scope pacifique-gdms-projects 2>&1 | awk '$1=="url"{print $2}')
# Sans l'adresse de la version en ligne, aucun retour arrière n'est possible : un nouvel essai, puis arrêt avant toute mise en ligne.
[ -n "$PREV" ] || { sleep 20; PREV=$(cd "$DEPLOY" && MSYS_NO_PATHCONV=1 timeout 90 vercel inspect acadea-app.vercel.app --scope pacifique-gdms-projects 2>&1 | awk '$1=="url"{print $2}'); }
[ -n "$PREV" ] || stop "version en ligne avant introuvable (réseau ?) : rien n'est mis en ligne ; relancer la mise en ligne plus tard"
echo "  version en ligne avant : $PREV"
git -C "$DEPLOY" fetch -q origin && git -C "$DEPLOY" merge -q --ff-only origin/main || stop "mise à jour du dossier de déploiement"
[ "$(git -C "$DEPLOY" rev-parse HEAD)" = "$SHA" ] || stop "main ne correspond pas à la fusion"
out=$(node "$DEPLOY/scripts/release/deploy-production-manual.cjs" "--cwd=$DEPLOY" 2>&1 | grep "^{\"status\"" | tail -1); echo "  construction : $out"
URL=$(echo "$out" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).url||"")}catch{console.log("")}})')
[ -n "$URL" ] || stop "construction échouée"
ACADEA_DEPLOY_DIR="$DEPLOY" bash "$DEPLOY/scripts/release/verify-production-build.sh" "$URL" "$SHA" || stop "vérification de la construction (rien n'est en ligne)"

# 5. Mise en ligne puis vérifications du site en ligne.
(cd "$DEPLOY" && timeout 180 vercel promote "$URL" --scope pacifique-gdms-projects --yes 2>&1 | tail -1)
ACADEA_DEPLOY_DIR="$DEPLOY" bash "$DEPLOY/scripts/release/verify-production-build.sh" https://acadea-app.vercel.app "$SHA" >/dev/null 2>&1 || sleep 30
ACADEA_DEPLOY_DIR="$DEPLOY" bash "$DEPLOY/scripts/release/verify-production-build.sh" https://acadea-app.vercel.app "$SHA" || stop "vérification du site en ligne : RETOUR ARRIÈRE = vercel promote $PREV --scope pacifique-gdms-projects --yes"
echo "EN LIGNE : Version $NEWV — $URL ($SHA) ; retour arrière : vercel promote $PREV --scope pacifique-gdms-projects --yes"

# 6. Journal local facultatif (la liste officielle est CHANGELOG.md, versionnée dans le dépôt).
if [ -n "${ACADEA_JOURNAL:-}" ]; then
  TITLE=$(gh pr view "$PR" --repo "$REPO" --json title --jq .title)
  { echo; echo "## Version $NEWV — $(date '+%d/%m/%Y %H:%M') — PR #$PR"; echo "- $TITLE"
    git -C "$DEPLOY" show "$SHA:CHANGELOG.md" | awk -v v="## [$NEWV]" 'index($0,v)==1{f=1;next} /^## \[/{f=0} f && /^- /{print "  " $0}'
    echo "- En ligne : $URL ($SHA) ; retour arrière : vercel promote $PREV --scope pacifique-gdms-projects --yes"; } >> "$ACADEA_JOURNAL"
  echo "  journal : version $NEWV notée"
fi
