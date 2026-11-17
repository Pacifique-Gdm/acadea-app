#!/usr/bin/env bash
# Vérifie une construction de production AVANT sa mise en ligne (ou le site en ligne après).
# Usage : bash scripts/release/verify-production-build.sh <adresse https> <sha attendu>
# Lecture seule : uniquement des requêtes GET (et un POST sans identifiants qui doit être refusé).
set -u
URL="$1"; SHA="$2"; SCOPE="pacifique-gdms-projects"; DEPLOY_DIR="${ACADEA_DEPLOY_DIR:-C:/Users/Pacifique BILOMBI/Documents/AC-production-deploy}"
WORK="$(cygpath -m "$(mktemp -d)")"; ok=0; ko=0
get() { (cd "$DEPLOY_DIR" && MSYS_NO_PATHCONV=1 timeout 90 vercel curl "$1" --deployment "$URL" --scope "$SCOPE" -- -s -o "$2" -w "%{http_code}" "${@:3}" 2>/dev/null); }
check() { if [ "$2" = "1" ]; then echo "  OK   $1"; ok=$((ok+1)); else echo "  ÉCHEC $1"; ko=$((ko+1)); fi; }

code=$(get /version.json "$WORK/v.json"); v=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)}catch{console.log("")}' "$WORK/v.json")
check "version.json = $SHA (HTTP $code, lu : ${v:0:12})" "$([ "$code" = 200 ] && [ "$v" = "$SHA" ] && echo 1)"
code=$(get /login "$WORK/login.html"); bundle=$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' "$WORK/login.html" | head -1)
check "/login répond avec l'application (HTTP $code)" "$([ "$code" = 200 ] && [ -n "$bundle" ] && echo 1)"
code=$(get /dashboard "$WORK/dash.html"); check "/dashboard sert la même application (HTTP $code)" "$([ "$code" = 200 ] && grep -q "$bundle" "$WORK/dash.html" && echo 1)"
code=$(get "$bundle" "$WORK/bundle.js"); check "code principal téléchargé (HTTP $code)" "$([ "$code" = 200 ] && echo 1)"
check "Firebase de PRODUCTION dans le code (projectId acadea-production, jamais acadea-staging)" "$(grep -q 'projectId:"acadea-production"' "$WORK/bundle.js" && ! grep -q 'projectId:"acadea-staging"' "$WORK/bundle.js" && echo 1)"
code=$(get /manifest.webmanifest "$WORK/m.json"); check "manifeste (HTTP $code)" "$([ "$code" = 200 ] && echo 1)"
code=$(get /sw.js "$WORK/sw.js"); check "service worker (HTTP $code)" "$([ "$code" = 200 ] && echo 1)"
code=$(get /acadea-icon.png "$WORK/icon.png"); size=$(wc -c < "$WORK/icon.png"); check "icône allégée (HTTP $code, $size octets)" "$([ "$code" = 200 ] && [ "$size" -lt 150000 ] && echo 1)"
code=$(get /api/provision-school-account "$WORK/api.txt" -X POST -H "Content-Type: application/json" --data '{}'); check "API refuse sans connexion (HTTP $code)" "$([ "$code" = 401 ] && echo 1)"
echo "Résultat : $ok OK, $ko échec(s)"; rm -rf "$WORK"; [ "$ko" = 0 ]
