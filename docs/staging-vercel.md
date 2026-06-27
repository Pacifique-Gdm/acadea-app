# Acadéa - Environnement de préproduction

Ce document décrit la séparation des environnements Acadéa sans modifier le fonctionnement applicatif existant.

## Environnements

- Development: poste local, fichier `.env` basé sur `.env.example`.
- Preview / Staging: Vercel Preview Deployments, Firebase projet de test séparé.
- Production: Vercel Production Deployment, Firebase projet production séparé.

Les données staging doivent toujours utiliser un projet Firebase différent de la production.

## Branches Git recommandées

- `develop`: intégration et tests. Chaque push déclenche un Preview Deployment Vercel.
- Pull Request vers `main`: déclenche un Preview Deployment Vercel.
- `main`: seule branche autorisée pour Production.

Dans Vercel:

1. Project Settings > Git.
2. Production Branch: `main`.
3. Les autres branches, dont `develop`, restent en Preview.
4. Branch protection GitHub recommandée sur `main`: PR obligatoire + lint/build OK.

Le script `scripts/verifyProductionBranch.cjs` bloque aussi un build production Vercel si la branche n'est pas `main`.

## Variables d'environnement

Configurer ces variables dans Vercel pour chaque environnement:

```bash
VITE_APP_ENV=
VITE_STAGING_BANNER=
VITE_STAGING_LABEL=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
ACADEA_ALLOW_FIRESTORE_IMPORT=false
ACADEA_ALLOW_FIRESTORE_SEED=false
```

Development:

```bash
cp .env.example .env
npm install
npm run dev
```

Preview / Staging:

```bash
VITE_APP_ENV=staging
VITE_STAGING_BANNER=true
VITE_STAGING_LABEL=ENVIRONNEMENT DE TEST
VITE_FIREBASE_PROJECT_ID=<firebase-staging-project-id>
```

Sur Vercel, si `VITE_APP_ENV` n'est pas défini, `vite.config.ts` reprend automatiquement `VERCEL_ENV`. Un Preview Deployment reçoit donc `preview`, ce qui affiche aussi la bannière de test.

Production:

```bash
VITE_APP_ENV=production
VITE_STAGING_BANNER=false
VITE_FIREBASE_PROJECT_ID=<firebase-production-project-id>
```

## Bannière Staging

Quand `VITE_APP_ENV=staging` ou `VITE_STAGING_BANNER=true`, l'application affiche une bannière visible sur toutes les pages:

```text
ENVIRONNEMENT DE TEST
```

Cette bannière est uniquement visuelle. Elle ne change aucune logique métier.

## Données de démonstration

Le seed couvre:

- Super Administrateur
- Écoles
- Administrateurs
- Parent
- Élèves
- Enseignants
- Paiements
- Classes
- Notifications
- Dépenses
- Audit logs

Importer les données dans le projet Firebase ciblé par les variables locales:

```bash
npm run seed:staging
```

Protection obligatoire du seed Firestore:

- `VITE_FIREBASE_PROJECT_ID` doit contenir `staging`, `preview`, `test`, `demo` ou `dev`.
- `ACADEA_ALLOW_FIRESTORE_SEED=true` doit être défini uniquement pour une opération staging explicite.
- Le seed est refusé si `VITE_APP_ENV=production`.

Commande PowerShell:

```powershell
$env:ACADEA_ALLOW_FIRESTORE_SEED="true"
npm run seed:staging
```

## Import localStorage/demoData vers Firestore

La persistance métier utilise Firestore quand Firebase est configuré. `localStorage` reste un cache et un fallback temporaire si Firestore est indisponible.

Importer les données de démonstration:

```powershell
$env:ACADEA_ALLOW_FIRESTORE_IMPORT="true"
npm run import:firestore
```

Importer un export localStorage JSON:

```powershell
$env:ACADEA_ALLOW_FIRESTORE_IMPORT="true"
$env:ACADEA_LOCAL_DATA_FILE="C:\chemin\vers\acadea-app-data.json"
npm run import:firestore
```

Protections:

- l'import est refusé en production;
- le projet Firebase doit être un projet staging/preview/test/demo/dev;
- `ACADEA_ALLOW_FIRESTORE_IMPORT=true` est obligatoire pour chaque import.

## Reset complet de la base staging

Le reset supprime les collections de test puis réimporte les données de démonstration.

Protection obligatoire:

- `VITE_FIREBASE_PROJECT_ID` doit contenir `staging`, `preview`, `test` ou `demo`.
- `ACADEA_ALLOW_STAGING_RESET=true` doit être défini.

Commande PowerShell:

```powershell
$env:ACADEA_ALLOW_STAGING_RESET="true"
npm run reset:staging
```

Ne jamais exécuter cette commande avec les variables Firebase production.

## Déploiement Preview

1. Créer ou mettre à jour la branche `develop`.
2. Pousser:

```bash
git push origin develop
```

3. Ouvrir le Preview Deployment généré par Vercel.
4. Vérifier que la bannière `ENVIRONNEMENT DE TEST` est visible.
5. Tester:
   - connexion Super Administrateur;
   - sélection d'année scolaire;
   - dashboard;
   - élèves;
   - parents;
   - paiements;
   - notifications;
   - rapports;
   - rôles et permissions;
   - abonnements SaaS.

## Déploiement Production

1. Ouvrir une Pull Request de `develop` vers `main`.
2. Vérifier le Preview Deployment de la PR.
3. Vérifier:

```bash
npm install
npm run lint
npm run build
```

4. Merger vers `main`.
5. Vercel déploie Production depuis `main` uniquement.

## Ajouter une variable

1. Ajouter la variable dans `.env.example`.
2. Si staging seulement, ajouter aussi dans `.env.staging.example`.
3. Si production, ajouter dans `.env.production.example`.
4. Ajouter la variable dans Vercel pour Development / Preview / Production selon le besoin.
5. Documenter son effet dans ce fichier.
