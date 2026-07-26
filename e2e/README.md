# Tests E2E Acadéa

Ces tests ciblent uniquement `https://acadea-staging.vercel.app` ou un serveur local relié à `VITE_FIREBASE_PROJECT_ID=acadea-staging`. La configuration refuse toute URL/projectId Production et refuse un environnement déclaré `production` sans `ACADEA_E2E_CONFIRM_STAGING=YES`.

## Secrets locaux ou CI

Définir, sans les committer, les couples `E2E_<ROLE>_EMAIL` / `E2E_<ROLE>_PASSWORD` pour `SUPER_ADMIN`, `SCHOOL_ADMIN`, `CASHIER`, `PARENT` et `DISCIPLINE_DIRECTOR`. Utiliser exclusivement des comptes Staging dédiés.

## Données isolées

Toute donnée créée par une future fixture doit porter un identifiant `e2e-<timestamp>-<uuid>-...`. `TestDataCleanup` refuse d'enregistrer un nettoyage pour un identifiant sans préfixe `e2e-`. Le nettoyage doit cibler uniquement les identifiants possédés par le test; une donnée existante ne doit jamais être supprimée.

## Exécution

1. Installer Chromium une fois avec `npx playwright install chromium`.
2. Définir `VITE_FIREBASE_PROJECT_ID=acadea-staging` et les secrets Staging.
3. Lancer `npm run test:e2e:staging`.

Les tests unitaires peuvent tourner sur chaque PR. Les tests E2E nécessitent les secrets Staging. Les futurs scénarios de création/paiement/présence modifieront temporairement Firestore Staging et devront utiliser la stratégie de propriété/nettoyage ci-dessus.
