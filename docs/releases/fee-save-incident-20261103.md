# Correctif ciblé des types de frais — 3 novembre 2026

Base Production : `d50f874e0fc6ac0079deb89602777f87b9971cad` (PR #41).
Secours à conserver : `dpl_J6xbyuNHmMb25PR8KkQcRKktEhfT`.

## Preuves et périmètre

- Le navigateur Administrateur examiné chargeait `/assets/index-CIYDI-0f.js`, identique au bundle public de ce SHA. Un ancien bundle n'explique donc pas cette session examinée.
- Sept POST financiers retrouvés le 2 novembre entre 20:34 et 20:44 UTC étaient HTTP 200. Les traces ne distinguaient pas l'action métier ; elles ne permettent pas d'attribuer la dernière tentative signalée ni de conclure à l'existence de son frais.
- Le parcours `addFeeKind` faisait encore une mise à jour cliente optimiste de `schoolYears.customFeeKindChoices`. La règle d'une école sous coordination active refuse cette écriture : refus 403 reproduit sur émulateur, sans modification de règles.
- Le formulaire peut proposer des classes historiques, dont « 1ère Sciences », rejetées par la liste fixe de `saveFeeTypes`. Le cas est couvert avec des élèves fictifs de la même école et année.

## Correctif conservé

1. Action `add-fee-kind` dans l'API financière existante : identité active, école/année active, transaction limitée à la liste de libellés, audit et reçu d'idempotence. Aucun droit client supplémentaire sur l'année.
2. Le formulaire attend la confirmation. Une réponse perdue conserve le même identifiant de demande. Les refus confirmés sont affichés avec leur vraie cause.
3. Les classes historiques restent inchangées et doivent être justifiées par les élèves du même établissement et de la même année, ou par le frais autorisé en cours de modification. Aucun accès interétablissement ajouté.
4. La sélection est bornée à 100 cibles (au lieu de 30), dans une transaction atomique. Les montants et les frais existants ne sont pas migrés.
5. Les traces de l'API indiquent action, étape, statut et code, sans corps de requête, jeton, nom, établissement ou montant.

## Validation

Preuves déjà obtenues localement : 22 tests ciblés PASS ; quatre tests de règles PASS ; scénario Chromium authentifié PASS avec Auth/Firestore/Storage locaux et vraie API HTTP. Le scénario couvre l'école coordonnée, la classe historique, les réponses perdues, l'idempotence, la concurrence, les refus 400/403/409, l'affichage du refus et le nettoyage vérifié des fixtures.

Le scénario est intégré au job CI existant `offline-emulator-e2e`, sans authentification distante et sans modification des approbations. Les résultats CI du SHA final font foi pour l'intégration finale. Une recette sur émulateurs n'est pas une recette Firebase hébergée.

Validation de récupération : 40 tests financiers ciblés, TypeScript et lint locaux réussis. Le build Staging local reste bloqué par les cinq variables absentes de ce worktree ; le build officiel CI réussit avec sa configuration dédiée, sans accès Firebase distant. Les CI ont exécuté 2 393 tests applicatifs, 149 tests Functions, 443 tests Firestore (un ignoré), 54 tests Storage, cinq scénarios hors connexion et le scénario de frais authentifié. Le runner Chromium étendu a également réussi ses 16 scénarios existants et le scénario de frais après séparation du serveur Vite des composants (4173) et du bundle avec vraie API HTTP (4187). Les sorties Playwright sont séparées pour conserver les preuves entre les deux commandes.

Le déploiement de secours a été vérifié READY. Les Preview Vercel sont contrôlés par l'accès officiel `vercel curl /version.json` ; la concordance finale et les CI du dernier commit sont consignées dans la PR. Aucun enregistrement authentifié sur Firebase hébergé n'a été exécuté : la preuve de bout en bout concerne les émulateurs, avec authentification réelle locale et transaction du handler candidat.

## Livraison contrôlée proposée

- Aucun changement de règles Firestore/Storage, d'index, de Functions Firebase ou de données existantes ; aucune purge IndexedDB.
- Après autorisation explicite seulement : préserver le secours, contrôler le SHA et les CI, fusionner cette seule PR, vérifier les CI intégrées, construire l'application et son API ensemble, puis promouvoir le build validé.
- Vérifier `/version.json`, routes/API sans écriture, manifeste et Service Worker, ainsi que les journaux disponibles. Ne jamais créer de frais réels pour tester.
- En cas d'incident, conserver les reçus et libellés déjà enregistrés. Le secours sait lire les libellés mais réintroduit le défaut de création : préférer un correctif compatible et ne pas répéter à l'aveugle une demande dont la confirmation est incertaine.
- Aucune fusion ni publication Production n'est effectuée dans cette préparation. L'incident Production ne doit pas être déclaré clos avant livraison et contrôles autorisés.
