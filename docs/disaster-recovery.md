# Plan de reprise apres incident Acadea

Ce document decrit la procedure de sauvegarde et de restauration pour Acadea Production.
Il ne contient aucun secret et ne doit jamais contenir de cle de service, token, mot de passe ou donnees personnelles exportees.

## Principes

- Production et Staging restent strictement separes.
- Une restauration est toujours testee hors Production avant toute action definitive.
- Aucun backup Production ne doit etre importe dans Staging sans controle de confidentialite.
- Les UID Firebase Authentication doivent etre conserves pour maintenir les liens avec `users/{uid}` et les profils metier.
- Les exports doivent etre stockes dans un bucket reserve aux sauvegardes, avec acces restreint.

## Gel des ecritures

En cas d'incident grave:

1. Identifier le perimetre touche: Firestore, Authentication, Storage ou API.
2. Prevenir les administrateurs de la suspension temporaire possible.
3. Si les donnees continuent a etre corrompues, bloquer temporairement les ecritures via une mesure operationnelle controlee:
   - desactiver temporairement les actions d'administration sensibles;
   - ou deployer des regles restrictives apres validation;
   - ou suspendre le trafic applicatif si l'incident est critique.
4. Ne jamais supprimer de donnees pendant le diagnostic initial.

## Sauvegarde Firestore

### Strategie recommandee

- Export automatique quotidien de Firestore Production.
- Conservation minimale recommandee:
  - 30 sauvegardes quotidiennes;
  - 12 sauvegardes mensuelles;
  - conservation plus longue avant cloture d'annee scolaire si necessaire.
- Stockage dans un bucket dedie, par exemple:
  - `acadea-production-firestore-backups`
- Acces limite aux comptes d'exploitation autorises uniquement.

### Commande manuelle de reference

La commande doit toujours cibler explicitement le projet Production:

```bash
gcloud firestore export gs://acadea-production-firestore-backups/firestore/$(date +%Y-%m-%d) --project=acadea-production
```

Sur Windows PowerShell:

```powershell
$date = Get-Date -Format "yyyy-MM-dd"
gcloud firestore export "gs://acadea-production-firestore-backups/firestore/$date" --project=acadea-production
```

### Action manuelle restante

L'automatisation quotidienne necessite generalement Google Cloud Billing, Cloud Scheduler et un compte de service d'exploitation.
Ne pas l'activer sans validation explicite.

## Sauvegarde Firebase Authentication

### Objectif

Conserver les comptes Auth et leurs UID afin de maintenir la correspondance avec:

- `users/{uid}`;
- les custom claims;
- les profils parents et utilisateurs.

### Export de reference

```bash
firebase auth:export ./secure-backups/auth-users.json --project acadea-production
```

Le fichier exporte doit etre stocke hors depot, dans un emplacement chiffre et controle.
Ne jamais committer ce fichier.

### Restauration de reference

```bash
firebase auth:import ./secure-backups/auth-users.json --project acadea-restore-test
```

Tester d'abord sur un projet temporaire. Verifier ensuite:

- UID conserves;
- emails presents;
- statuts `disabled`;
- custom claims remis si l'outil d'export ne les restaure pas automatiquement.

## Sauvegarde Storage

### Donnees concernees

- pieces jointes Valves;
- logos d'ecole ou de plateforme;
- photos;
- futurs documents scolaires.

### Strategie recommandee

- Sauvegarde periodique du bucket Production vers un bucket backup separe.
- Versioning Storage possible si le cout est accepte.
- Restauration testee sur un bucket temporaire avant Production.

### Commande de copie de reference

```bash
gcloud storage rsync -r gs://acadea-production.firebasestorage.app gs://acadea-production-storage-backups/latest --project=acadea-production
```

Adapter le nom exact du bucket Production avant execution.

### Action manuelle restante

Activer le versioning ou creer un bucket backup peut avoir un impact cout. Ne pas l'activer sans validation explicite.

## Selection du backup sain

1. Identifier l'heure approximative de debut d'incident.
2. Choisir le dernier backup anterieur a l'incident.
3. Verifier que le backup contient:
   - ecoles;
   - annees scolaires;
   - utilisateurs;
   - parents;
   - eleves;
   - paiements;
   - depenses;
   - messages;
   - notifications;
   - Valves;
   - presences;
   - sanctions;
   - parametres.
4. Documenter le backup choisi et la raison.

## Restauration hors Production

Toujours restaurer d'abord dans un projet temporaire ou Staging dedie a la validation:

```bash
gcloud firestore import gs://acadea-production-firestore-backups/firestore/YYYY-MM-DD --project=acadea-restore-test
```

Verifier ensuite:

- connexions de test;
- affichage des ecoles;
- coherence des UID Auth avec `users/{uid}`;
- paiements et soldes;
- messages et notifications;
- acces Storage;
- absence de melange avec Production.

## Restauration Production

La restauration Production ne doit commencer qu'apres validation explicite.

Procedure:

1. Confirmer le gel des ecritures.
2. Confirmer le backup sain.
3. Confirmer le plan de retour arriere.
4. Restaurer Firestore avec `--project=acadea-production`.
5. Restaurer Authentication si necessaire en conservant les UID.
6. Restaurer Storage si necessaire.
7. Rejouer uniquement les operations metier validees depuis l'heure du backup si elles sont disponibles.
8. Reactiver progressivement les acces.

## Controles post-restauration

Verifier au minimum:

- connexion Super Administrateur;
- connexion Administrateur;
- connexion Caissier;
- connexion Directeur de Discipline;
- connexion Parent;
- ecoles et annees scolaires;
- eleves et parents lies;
- types de frais;
- paiements et depenses;
- messages et notifications;
- Valves et pieces jointes;
- presences et parametres;
- regles Firestore et Storage;
- `/api/health`.

## Ce qui ne se restaure pas automatiquement

- Les mots de passe en clair n'existent pas et ne doivent jamais etre stockes.
- Les sessions deja ouvertes peuvent devoir etre renouvelees.
- Les emails transactionnels ou notifications externes deja envoyes ne sont pas annulables.
- Les PDF telecharges localement par les utilisateurs ne sont pas controles par Acadea.

## Frequence de test

- Test de restauration Firestore: au moins trimestriel.
- Test Auth avec comptes fictifs: au moins semestriel.
- Test Storage: au moins trimestriel si les pieces jointes sont critiques.
- Revue des droits d'acces aux backups: mensuelle.
