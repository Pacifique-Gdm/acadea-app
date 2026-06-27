# Configuration Firebase production des roles Acadea

Ce projet utilise trois sources complementaires pour securiser les acces:

- Firebase Authentication pour l'identite.
- Firestore custom claims pour l'autorisation cote regles de securite.
- Le document `users/{uid}` pour le profil applicatif utilise par le frontend apres connexion.

## Claims attendus

Les regles Firestore lisent:

```js
request.auth.token.role
request.auth.token.schoolId
request.auth.token.parentId
```

Valeurs de `role` actuellement attendues par le code et les regles:

- `super_admin`: acces plateforme uniquement.
- `school_admin`: acces dashboard ecole uniquement, avec `schoolId` obligatoire.
- `cashier`: role metier ecole, avec `schoolId` obligatoire.
- `parent`: role parent, avec `schoolId` et `parentId` obligatoires.

Important: ne pas utiliser `superadmin` ou `admin` en production sans modifier aussi le code et les regles. La version actuelle attend precisement `super_admin` et `school_admin`.

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

Le Super Admin ne doit pas avoir besoin d'un `schoolId`. Il accede a `/platform` et ne doit pas acceder aux collections metier des ecoles.

## Administrateur d'ecole

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
  "name": "Nom de l'admin ecole",
  "email": "direction@ecole.com",
  "role": "school_admin",
  "schoolId": "school_abc123",
  "activeSchoolYearId": "year_2026"
}
```

Le `schoolId` du claim et celui du document utilisateur doivent etre identiques.

## Caissier

Custom claims:

```json
{
  "role": "cashier",
  "schoolId": "school_abc123"
}
```

## Parent

Custom claims:

```json
{
  "role": "parent",
  "schoolId": "school_abc123",
  "parentId": "parent_abc123"
}
```

Document Firestore `users/{uid}`:

```json
{
  "name": "Nom du parent",
  "email": "parent@domaine.com",
  "role": "parent",
  "schoolId": "school_abc123",
  "parentId": "parent_abc123",
  "status": "active"
}
```

Le `parentId` du claim doit correspondre au document `parents/{parentId}` et au champ `parentId` present sur les eleves du parent.

## Etapes Firebase Console

1. Creer le projet Firebase.
2. Activer Authentication.
3. Activer le fournisseur `Email/Password`.
4. Creer les utilisateurs dans Authentication.
5. Creer les documents correspondants dans Firestore, collection `users`, avec l'UID Firebase comme ID de document.
6. Creer les documents `schools`, `schoolYears` et autres donnees de base avec le meme `schoolId`.
7. Definir les custom claims avec Firebase Admin SDK.
8. Deployer les regles Firestore:

```bash
firebase deploy --only firestore:rules
```

9. Deployer l'application:

```bash
npm run build
firebase deploy --only hosting
```

## Tester les roles

Apres avoir defini ou modifie des custom claims:

1. Deconnecter l'utilisateur.
2. Reconnecter l'utilisateur pour forcer le renouvellement du token.
3. Tester:
   - Super Admin: `/platform` doit s'ouvrir.
   - Super Admin: `/dashboard` doit etre refuse.
   - Admin ecole: `/dashboard` doit s'ouvrir seulement pour son ecole.
   - Admin ecole: `/platform` doit etre refuse.
   - Parent: `/dashboard` doit ouvrir uniquement l'espace parent.
   - Parent: aucun menu admin ou super admin ne doit etre visible.
   - Parent: seuls les eleves lies a son `parentId` doivent etre visibles.
   - Une lecture Firestore avec un autre `schoolId` ou un autre `parentId` doit etre refusee.

## Points de controle

- Toutes les donnees metier doivent contenir `schoolId`.
- Les donnees parentales doivent aussi contenir `parentId` quand elles sont destinees a un parent.
- Les requetes frontend doivent filtrer avec le `schoolId` du profil connecte.
- Les requetes parent doivent filtrer avec `schoolId` et `parentId`.
- Les regles Firestore doivent rester la barriere finale: aucune collection metier ne doit permettre une lecture globale.
- Le compte Super Admin ne doit pas etre utilise comme compte ecole.
