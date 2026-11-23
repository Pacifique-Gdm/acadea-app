# État du lot 4 du Super administrateur : drawer d'école léger

Branche : `claude/super-admin-4`, partie de `origin/claude/super-admin-ecoles-drawer` (PR #129, pas encore fusionnée, `3080a2e`).
Commit du travail : `e2d2bcb`, envoyé sur `origin/claude/super-admin-4` (pas de PR tant que la #129 n'est pas fusionnée).

## Étapes
- [x] Lecture des consignes, étude du drawer.
- [x] Serveur : nombres calculés et historique par pages.
- [x] Écran : une seule demande au serveur à l'ouverture, bouton « Voir plus » dans l'historique.
- [x] Tests qui échouent sur l'ancien code, puis passent ; `npx tsc -b` et `npx eslint` sans erreur.
- [x] Mesure avant/après sur l'émulateur local, nettoyage vérifié.
- [x] Suite complète : 3 429 réussis, 4 échecs de lenteur sans lien (3 repassent seuls ; le 4e, lecture PDF du module Études, dépasse 5 s).
- [ ] Remise sur main quand la #129 sera fusionnée, puis `version-bump.mjs fonctionnalite`, puis PR.
- [ ] Mesure sur le staging : **seulement avec le feu vert de la session mère**.

## Ce qui change
- `api/manage-school.js` : deux nouvelles actions, `school-drawer` (nombres + 1re page d'historique) et
  `school-history` (page suivante). Réservées au Super administrateur (refus 403 pour tous les autres rôles,
  sans aucune lecture), limite anti-abus existante `MESSAGE_RECIPIENTS`. Aucune nouvelle page `api/`
  (le projet en a déjà 12, la limite de Vercel).
- `api/_lib/schoolDrawerSummary.js` : calcul avec les mêmes règles que l'ancien écran (élèves de l'année,
  parents liés à ces élèves, comptes non retirés, élèves archivés hors répartition par classe).
  Lecture des seuls champs utiles. Historique trié, sans les connexions, 10 lignes par page ;
  les pages suivantes sont gardées 2 minutes par le serveur.
- `src/services/schoolDrawerSummary.ts` : appel et vérification stricte de la réponse (jamais un chiffre faux).
- `PlatformModule.tsx` : le drawer n'utilise plus `loadSuperAdminSchoolData` (élèves, parents, paiements,
  dépenses, messages, notifications, journaux, valves, frais, terminaux, comptes). La mémoire de la #129
  garde maintenant les nombres et l'historique reçus.
- Écoute en temps réel des comptes : limitée aux administrateurs de l'école pour le Super administrateur.
- **Aucune règle Firestore, aucun index, aucune fonction Firebase** : requêtes « == » seulement.

## Mesure sur l'émulateur (21/11, école d'essai de 1 942 documents)
École : 400 élèves, 250 parents, 40 comptes, 800 paiements, 150 dépenses, 60 messages, 80 notifications,
120 lignes de journal, 15 valves, 25 frais, 2 terminaux.

| Ouverture d'un drawer | Demandes | Documents reçus par le navigateur | Données reçues |
|---|---|---|---|
| Avant | 14 | 1 984 | 718 Ko |
| Après | 4 (1 au serveur + administrateurs + quota d'IA + compteur) | 5 (+ 1 réponse) | 3,2 Ko |

- Lectures faites par le serveur après : 810 documents (élèves, parents, comptes, journal), champs utiles seulement.
- « Voir plus » : 1,7 Ko, sans nouvelle lecture du journal pendant 2 minutes.
- Nombres obtenus : 400 élèves, 250 parents, 3 administrateurs, 35 comptes, 10 classes ; historique 112 lignes.
- Script : `tmp/sa4-mesure-emulateur.mjs` (marque `e2e-sa4-…`). Nettoyage : **0 reste**. Aucun compte de connexion créé.

## Index de l'historique (accord de l'utilisateur, 21/11) — commit `d5228d8`
Le serveur lit seulement la page demandée. Les deux formats de date du journal (horodatage du serveur et texte
des anciennes lignes) passent par le même index. **Sans index, repli automatique** sur la lecture complète :
le drawer marche avant, pendant et après l'installation, et après un retour arrière.

Définition (déjà ajoutée en tête de `firestore.indexes.json`) :
```json
{ "collectionGroup": "auditLogs", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "schoolId", "order": "ASCENDING" },
              { "fieldPath": "schoolYearId", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "DESCENDING" } ] }
```

Mesure sur l'émulateur (120 lignes, dates mêlées) : **26 lectures par page avec l'index**, au lieu de 120
(toutes les lignes) sans index. Avec l'index, ce nombre ne grandit plus avec la taille du journal.
Les 112 lignes visibles passent une seule fois chacune, dans l'ordre.

### PRODUCTION (à faire par la session mère, au moment de la mise en ligne du lot 4)
Installer **seulement cet index** (ne jamais republier tout `firestore.indexes.json`) :
```bash
gcloud firestore indexes composite create --project=acadea-production --database="(default)" --collection-group=auditLogs --query-scope=COLLECTION --field-config=field-path=schoolId,order=ascending --field-config=field-path=schoolYearId,order=ascending --field-config=field-path=createdAt,order=descending --async
```
Vérifier qu'il est prêt (`READY`) et noter son identifiant (fin de `name`, après `indexes/`) :
```bash
gcloud firestore indexes composite list --project=acadea-production --database="(default)" --format="table(name,state,fields)" | grep auditLogs
```
Retour arrière (le drawer revient seul à l'ancienne lecture) :
```bash
gcloud firestore indexes composite delete <IDENTIFIANT> --project=acadea-production --database="(default)" --quiet
```
Ordre : l'index peut être installé avant ou après la mise en ligne. Conseillé : l'installer d'abord et
attendre `READY` (quelques minutes), puis lancer `ship-lot.sh`. En cas de retour arrière, retirer aussi
l'index de `firestore.indexes.json` dans une PR suivante.

### Staging
- Feu vert reçu le 21/11 (publication de la branche + création de cet index seul ; l'index restera en place).
- Alias relu le 21/11 : `acadea-staging.vercel.app` → `acadea-staging-p5dkuyui9-pacifique-gdms-projects.vercel.app`
  (`dpl_E9RaJa3uPCUygN8QdcSckGjWVSSx`). Retour : `vercel alias set https://acadea-staging-p5dkuyui9-pacifique-gdms-projects.vercel.app acadea-staging.vercel.app --scope pacifique-gdms-projects`
- **Bloqué** : `gcloud auth print-access-token` ne répond plus (plus de 5 minutes, aucun message), alors que le
  réseau vers Google répond en quelques secondes. Le compte Google de `gcloud` doit sans doute être reconnecté
  sur cette machine (`gcloud auth login`, à faire par l'utilisateur). Vercel répond, lentement (40 s).
- Rien n'a été créé sur le staging (aucune école, aucun compte, aucun index, alias inchangé).
- Recette prête : `tmp/sa4-staging.mjs` (étapes preparer, mesurer, api, nettoyer).
- Retour arrière de l'index sur le staging (si besoin un jour) :
  `gcloud firestore indexes composite delete <IDENTIFIANT> --project=acadea-staging --database="(default)" --quiet`

- 21/11 : `gcloud` répond de nouveau (jeton en 74 s). Mais consigne de l'utilisateur, transmise par la session mère :
  terminer seulement un essai en cours, puis se mettre en pause, car le chantier du caissier passe avant.
  Aucun essai n'était en cours, donc rien n'a été lancé. Le lot 4 est **en pause** jusqu'à la relance de la session mère
  (mesures sur le staging, index, PR).

**STAGING LIBRE** (rien en cours, rien à nettoyer, alias jamais modifié).

## Limites connues
- Le serveur lit encore tous les élèves, parents et comptes de l'année (champs utiles seulement, sans le détail).
- Lignes de journal sans date ou avec une date d'un autre type : plus affichées quand l'index est utilisé
  (aucune ligne écrite par l'application n'est dans ce cas).
- `loadSuperAdminSchoolData` reste dans `src/services/superAdminData.ts` mais n'est plus utilisée par le drawer.
- Les terminaux biométriques viennent du chargement de départ (déjà toutes les écoles), plus relus à l'ouverture.

## Staging
Pas encore utilisé par ce lot.
