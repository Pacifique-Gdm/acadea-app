# Configuration Firebase production des rôles Acadéa

Ce projet utilise deux sources complémentaires pour sécuriser les accès:

- Firebase Authentication pour l'identité.
- Firestore custom claims pour l'autorisation côté règles de sécurité.
- Le document `users/{uid}` pour le profil applicatif utilisé par le frontend après connexion.

## Claims attendus

Les règles Firestore lisent:

```js
request.auth.token.role
request.auth.token.schoolId
```

Valeurs de `role` actuellement attendues par le code et les règles:

- `super_admin`: accès plateforme uniquement.
- `school_admin`: accès dashboard école uniquement, avec `schoolId` obligatoire.
- `cashier`: rôle métier école, avec `schoolId` obligatoire.
- `parent`: rôle parent, avec `schoolId` obligatoire.

Important: ne pas utiliser `superadmin` ou `admin` en production sans modifier aussi le code et les règles. La version actuelle attend précisément `super_admin` et `school_admin`.

## Super Administrateur

Custom claims:

```json
{
  "role": "super_admin"
}
```

Document Firestore `users/{uid}`:

```json
{
  "name": "Nom du super admin",
  "email": "admin@domaine.com",
  "role": "super_admin"
}
```

Le Super Admin ne doit pas avoir besoin d'un `schoolId`. Il accède à `/platform` et ne doit pas accéder aux collections métier des écoles.

## Administrateur d'école

Custom claims:

```json
{
  "role": "school_admin",
  "schoolId": "school_abc123"
}
```

Document Firestore `users/{uid}`:

```json
{
  "name": "Nom de l'admin école",
  "email": "direction@ecole.com",
  "role": "school_admin",
  "schoolId": "school_abc123",
  "activeSchoolYearId": "year_2026"
}
```

Le `schoolId` du claim et celui du document utilisateur doivent être identiques.

## Caissier et Parent

Ces rôles doivent aussi recevoir un `schoolId` dans les custom claims:

```json
{
  "role": "cashier",
  "schoolId": "school_abc123"
}
```

```json
{
  "role": "parent",
  "schoolId": "school_abc123"
}
```

## Étapes Firebase Console

1. Créer le projet Firebase.
2. Activer Authentication.
3. Activer le fournisseur `Email/Password`.
4. Créer les utilisateurs dans Authentication.
5. Créer les documents correspondants dans Firestore, collection `users`, avec l'UID Firebase comme ID de document.
6. Créer les documents `schools`, `schoolYears` et autres données de base avec le même `schoolId`.
7. Définir les custom claims avec Firebase Admin SDK.
8. Déployer les règles Firestore:

```bash
firebase deploy --only firestore:rules
```

9. Déployer l'application:

```bash
npm run build
firebase deploy --only hosting
```

## Tester les rôles

Après avoir défini ou modifié des custom claims:

1. Déconnecter l'utilisateur.
2. Reconnecter l'utilisateur pour forcer le renouvellement du token.
3. Tester:
   - Super Admin: `/platform` doit s'ouvrir.
   - Super Admin: `/dashboard` doit être refusé.
   - Admin école: `/dashboard` doit s'ouvrir seulement pour son école.
   - Admin école: `/platform` doit être refusé.
   - Une lecture Firestore avec un autre `schoolId` doit être refusée.

## Points de contrôle

- Toutes les données métier doivent contenir `schoolId`.
- Les requêtes frontend doivent filtrer avec le `schoolId` du profil connecté.
- Les règles Firestore doivent rester la barrière finale: aucune collection métier ne doit permettre une lecture globale.
- Le compte Super Admin ne doit pas être utilisé comme compte école.
