# Acadéa

Application web responsive de gestion d'établissements scolaires, construite avec React, TypeScript, Firebase, Tailwind CSS et génération PDF.

## Démarrage local

```bash
npm install
npm run dev
```

Le développement utilise Firebase Staging par défaut. Les commandes explicites sont :

```bash
npm run dev:staging
npm run dev:production
npm run build:staging
npm run build:production
```

Build:

```bash
npm run build
```

Qualité:

```bash
npm run lint
```

## Environnements

Acadéa distingue maintenant:

- Development : `.env.development` + Firebase `acadea-staging`.
- Staging : `.env.staging`, projet Vercel `acadea-staging` + Firebase `acadea-staging`.
- Production : `.env.production`, projet Vercel Production + Firebase `acadea-production`.

Une association différente bloque immédiatement le démarrage ou le build. Le build
Vercel exige également `VITE_APP_ENV=staging` ou `VITE_APP_ENV=production` et ne
choisit jamais silencieusement une cible.

Documentation complète: [docs/staging-vercel.md](docs/staging-vercel.md).

## Configuration Firebase

Renseigner les valeurs Firebase locales dans `.env.local` ou dans le fichier
`.env.<mode>.local` approprié. Ces fichiers sont ignorés par Git. Les fichiers
canoniques versionnés imposent toujours le mode et le projet Firebase :

```bash
VITE_APP_ENV=staging
VITE_STAGING_BANNER=true
VITE_STAGING_LABEL=ENVIRONNEMENT DE TEST
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=acadea-staging
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Le projet contient:

- `firebase.json` pour Firebase Hosting et Firestore.
- `firestore.rules` pour l'isolation par école et année scolaire.
- `scripts/setCustomClaims.cjs` pour attribuer des Custom Claims depuis un environnement serveur autorisé.

Les données d'écoles, y compris en test, doivent être créées dans Firebase.

## Comptes utilisateurs

Les connexions utilisent exclusivement Firebase Authentication. Chaque compte doit avoir:

- un utilisateur Firebase Authentication;
- un document Firestore `users/{uid}` correspondant;
- les custom claims Firebase attendues par les règles Firestore.

## Modules

- Connexion et sélection de l'année scolaire
- Dashboard
- Élèves
- Parents
- Contrôle des frais scolaires
- Rapports
- Messages
- Menu: paramètres école, années scolaires, parents, types de frais
- Reçus PDF

Toutes les données applicatives sont filtrées par `schoolId` et `schoolYearId`.
