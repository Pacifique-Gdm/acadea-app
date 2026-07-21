# Monitoring minimal Acadea

Ce document prepare la surveillance minimale d'Acadea sans ajouter de fournisseur externe ni secret.

## Objectifs

- Surveiller separement Staging et Production.
- Detecter rapidement une mauvaise configuration Firebase.
- Detecter les erreurs API Vercel.
- Surveiller les couts et quotas Firebase / Google Cloud.
- Ne jamais exposer de secret dans les alertes ou logs.

## Health check

Endpoint disponible:

```text
GET /api/health
```

Reponse attendue en Staging:

```json
{
  "status": "ok",
  "environment": "staging",
  "firebaseProjectId": "acadea-staging"
}
```

Reponse attendue en Production:

```json
{
  "status": "ok",
  "environment": "production",
  "firebaseProjectId": "acadea-production"
}
```

Une reponse `503` indique une configuration Firebase Admin indisponible ou incoherente.
Le corps de reponse ne doit contenir aucun secret et inclut uniquement un `requestId`.

## Verification manuelle

Staging:

```bash
curl -s https://acadea-staging.vercel.app/api/health
```

Production:

```bash
curl -s https://acadea-app.vercel.app/api/health
```

Verifier:

- `status` vaut `ok`;
- `environment` correspond a l'environnement attendu;
- `firebaseProjectId` correspond au projet Firebase attendu.

## Alertes Vercel recommandees

A configurer dans le projet Vercel correspondant, sans modifier l'autre projet.

Production `acadea-app`:

- alerte sur taux de reponses 5xx;
- alerte sur erreurs Functions;
- alerte sur hausse de latence;
- alerte si `/api/health` ne repond pas `200`.

Staging `acadea-staging`:

- memes alertes, mais canal separe ou etiquette `staging`;
- seuils moins stricts acceptables.

Action manuelle restante:

- configurer les alertes dans Vercel Dashboard si le plan Vercel le permet.

## Alertes Firebase / Google Cloud recommandees

Production:

- budget mensuel avec alertes a 50%, 75%, 90% et 100%;
- lectures Firestore anormales;
- ecritures Firestore anormales;
- suppressions Firestore anormales;
- Storage proche du seuil choisi;
- erreurs Authentication anormales;
- erreurs de regles Firestore ou Storage.

Staging:

- budget plus bas;
- alertes separees;
- surveillance des pics apres tests.

Action manuelle restante:

- activer Cloud Billing si necessaire;
- creer les budgets dans Google Cloud Billing;
- creer les alertes Cloud Monitoring.

## Quotas a surveiller

Firestore:

- lectures initiales par role;
- listeners temps reel des notifications/messages;
- `getCountFromServer` pour notifications non lues;
- refresh cible;
- imports et suppressions massives.

Storage:

- uploads Valves;
- taille totale des pieces jointes;
- suppressions de pieces jointes.

Authentication:

- creation de comptes;
- echecs de connexion;
- reinitialisations de mot de passe.

Vercel:

- executions des endpoints `/api/*`;
- duree des fonctions;
- erreurs 4xx/5xx;
- bande passante.

## Separation Staging / Production

Chaque alerte doit identifier:

- l'environnement;
- le projet Vercel;
- le projectId Firebase;
- le endpoint si applicable.

Ne pas melanger les logs Production et Staging sans etiquette explicite.

## Procedure en cas d'alerte

1. Identifier l'environnement touche.
2. Verifier `/api/health`.
3. Verifier les derniers deploiements Vercel.
4. Verifier les logs API par `requestId`.
5. Verifier les quotas Firebase.
6. Si les donnees sont potentiellement touchees, appliquer le plan `docs/disaster-recovery.md`.

## Donnees interdites dans les alertes

Ne jamais inclure:

- token;
- cookie;
- mot de passe;
- service account;
- cle privee;
- contenu de message prive;
- donnees personnelles non necessaires.
