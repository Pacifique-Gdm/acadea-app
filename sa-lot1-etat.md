# Lot 1 du Super administrateur : logos — état

Branche : `claude/super-admin-1` (depuis `origin/main` ba08249).
Feu vert de la session mère pour les 2 règles Firestore (accord de l'utilisateur) : reçu le 21/11.

## Ce qui change
- **Écoles** : vignette `logoThumbUrl` (8 000 caractères au plus, environ 4 Ko) posée sur
  `schools/{id}` à chaque nouveau logo. Les listes (`SchoolSaasCard`) n'affichent que la vignette,
  sans aucune lecture en plus. Le drawer de l'école (`<SchoolLogo full />`) lit le logo complet
  dans `schoolLogos`. Une école sans vignette affiche son logo complet, comme avant.
- **Coordinations** : logo complet rangé dans `coordinationLogos/{id}` (écrit par le serveur
  seulement). La coordination garde `logoVersion` et `logoThumbUrl`. Liste du Super administrateur
  et en-tête de la coordination : vignette. Détail, paramètres, PDF : logo complet lu à part.
  Les paramètres ne renvoient plus le logo s'il n'a pas changé.
- La vignette est fabriquée dans le navigateur (`src/services/logoThumbnail.ts`), contrôlée par le
  serveur (`api/_lib/logoThumbnail.js`) et par les règles.

## Règles Firestore
- Copie des règles d'avant : `git show origin/main:firestore.rules` (commit ba08249),
  aussi dans le dossier de travail temporaire `firestore.rules.avant-lot1`.
- Différence : `logoThumbUrl` ajouté à `schoolSettingsUpdate` + fonction `logoThumbnailOk`
  (chaîne, 1 à 8 000 caractères, `data:image/png|jpeg|webp;base64`) ; nouveau bloc
  `match /coordinationLogos/{coordinationId}` (lecture = celle de `coordinations`, écriture `false`).
- Tests sur l'émulateur : `tests/firestore/logoThumbnails.rules.ts`.
- Retour arrière des règles (staging) :
  `git show ba08249:firestore.rules > firestore.rules` puis
  `npx firebase deploy --only firestore:rules --project acadea-staging`.

## Migration (`scripts/logoThumbnailMigration.mjs`)
- Simulation sans `--apply`. Étapes : `backup` (obligatoire avant, `--backup-dir`), `migrate`,
  `verify`, `restore` (retour arrière, exige `--backup-file`).
- Production refusée sans `--production-autorisee=OUI` (en plus des confirmations habituelles).
- À lancer APRÈS la mise en ligne de la version qui lit `coordinationLogos`.
- Logique et retour arrière testés : `api/_lib/logoThumbnailMigration.test.ts`.

## Points d'attention
- Pendant la transition, un appareil resté sur l'ancienne version (1.17.0) qui change le logo d'une
  école laisserait l'ancienne vignette dans la liste jusqu'au prochain changement de logo. Rare.

## Avancement (EN PAUSE depuis le 21/11, à la demande de l'utilisateur)
- [x] Code et tests écrits, poussés sur `claude/super-admin-1` (commit « en cours », rien n'est vérifié)
- [ ] À la reprise : `npm ci` (interrompu, `node_modules` incomplet : le refaire),
      puis `npx tsc -b`, `npx eslint`, tests ciblés :
      `npx vitest run src/services/logoThumbnail.test.ts src/services/schoolLogo.test.ts src/services/schoolLogoUsage.test.ts src/api/manage-school.test.ts api/_lib/coordinationLogo.test.ts api/_lib/logoThumbnailMigration.test.ts src/modules/coordination`
      et les règles : `npx firebase emulators:exec --only firestore "npx vitest run --config vitest.firestore.config.ts tests/firestore/logoThumbnails.rules.ts tests/firestore/schoolLogos.rules.ts tests/firestore/coordination.rules.ts"`
- [ ] Vérifier que les tests échouent sur l'ancien code (main), suite complète une fois
- [ ] Version (`fonctionnalite`) depuis le dernier main, puis PR
- [ ] Staging (attente du feu vert de la session mère), mesure avant/après
- [ ] Préparer les 3 lignes de la migration de production
