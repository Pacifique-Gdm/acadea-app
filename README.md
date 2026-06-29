# Acadéa

Application web responsive de gestion d'établissements scolaires, construite avec React, TypeScript, Firebase, Tailwind CSS et génération PDF.

## Démarrage local

```bash
npm install
npm run dev
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

- Development: `.env` local basé sur `.env.example`.
- Preview / Staging: Vercel Preview Deployment + Firebase staging.
- Production: Vercel Production Deployment depuis `main` + Firebase production.

Documentation complète: [docs/staging-vercel.md](docs/staging-vercel.md).

## Configuration Firebase

Copier `.env.example` vers `.env` puis renseigner les valeurs Firebase:

```bash
VITE_APP_ENV=development
VITE_STAGING_BANNER=false
VITE_STAGING_LABEL=ENVIRONNEMENT DE TEST
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
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
