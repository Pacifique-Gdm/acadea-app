# Acadéa

Application web responsive de gestion d'établissements scolaires, construite avec React, TypeScript, Firebase, Tailwind CSS et génération PDF.

## Démarrage

```bash
npm install
npm run dev
```

Build de production:

```bash
npm run build
```

Vérification qualité:

```bash
npm run lint
```

## Configuration Firebase

Copier `.env.example` vers `.env` puis renseigner les valeurs Firebase:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

Le projet contient:

- `firebase.json` pour Firebase Hosting et Firestore
- `firestore.rules` pour l'isolation par école et année scolaire
- `scripts/seedDemo.ts` pour importer les données de démonstration

Importer les données de démonstration:

```bash
npm run seed
```

## Profils de démonstration

- `admin@acadea.demo`: Super Administrateur
- `direction@acadea.demo`: Administrateur d'école
- `caisse@acadea.demo`: Caissier
- `parent@acadea.demo`: Parent

## Modules

- Connexion et sélection de l'année scolaire
- Dashboard
- Élèves
- Contrôle des frais scolaires
- Messages
- Menu: paramètres école, années scolaires, parents, types de frais
- Reçus PDF

Toutes les données applicatives sont filtrées par `schoolId` et `schoolYearId`.
