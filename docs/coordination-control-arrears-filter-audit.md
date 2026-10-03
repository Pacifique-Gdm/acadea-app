# Filtre Contrôle Arriérés — garde-fou avant évolution du modèle

## Constat sur le candidat de départ 8d323b02

- `api/_lib/financialTransactions.js::historicalStudentRecords` reconstruit la filiation `importedFromStudentId`, puis la compatibilité de matricule/identité, et retient les années archivées antérieures. Une filiation ambiguë est refusée.
- `historicalDebts` lit les frais et paiements des fiches historiques et calcule `max(expected - paid, 0)` dans la devise de chaque année. `listStudentArrears` et `listScopedStudentArrears` sont les sources autorisées existantes.
- Aucun champ de total historique par devise n'existe dans `Student` ni dans les index `students`. Les transactions financières ne maintiennent pas une projection requêtable de ce total sur la fiche actuelle.
- La pagination des élèves est ordonnée par `sortName`/identifiant. Ajouter deux comparaisons sur la page obtenue ne paginerait pas l'ensemble des résultats financiers.

## Solution retenue pendant la reprise

Les champs « Arriérés ≥ / < » utilisent maintenant une action de lecture groupée dans les deux API existantes. Chaque appel contient au maximum 50 identifiants ; le serveur résout lui-même le périmètre et vérifie tous les élèves avant les lectures historiques. Les parents n'ont pas accès à cette action groupée.

Le calcul appelle les mêmes `historicalStudentRecords` et `historicalDebts`, avec des snapshots lus par lots : ascendance par niveau, matricules/années/frais/paiements avec `in` de 30 maximum. Les données restent locales à la requête, sans projection persistante ni cache partagé. Cycles, ascendants étrangers, école suspendue et ambiguïtés restent refusés. Le test de 50 élèves / deux années historiques compte 12 lectures groupées, pas un appel par élève.

Coordination/Sous-coordination parcourent les pages sources jusqu'à remplir 50 résultats correspondants, conservent le reliquat dans le curseur, puis poursuivent à la page suivante. Le filtre n'est pas appliqué aux seuls 50 premiers élèves. Administrateur/Caissier utilisent des lots de 50 sur leur modèle de contrôle existant, avant le découpage d'affichage. Sans filtre actif, aucune lecture historique groupée n'est ajoutée. Une réponse manquante n'est jamais assimilée à un solde zéro.

Aucune migration, aucun backfill, aucun index et aucune deuxième formule financière ne sont nécessaires à cette solution.

## Alternatives non retenues

1. Parcourir toutes les pages sources et appeler l'API canonique par élève éviterait les résultats manquants, mais introduirait précisément le N+1 interdit et un coût dépendant de tout le périmètre pour les filtres rares.
2. Le calcul groupé ci-dessus évite le N+1. Un filtre très rare peut toujours nécessiter plusieurs pages sources ; le coût de cette lecture est réel, non dissimulé par une projection fictive.
3. Une projection dérivée, indexée par école/année/devise et total restant, permettrait une requête bornée. Elle exige un changement de modèle significatif et une stratégie de réconciliation idempotente : paiement/correction/suppression, frais historiques, filiation/import, année et monnaie. Ce chantier doit s'arrêter avant une telle migration conformément à la mission.

La devise doit être explicite : comparer un montant USD aux seuls restes USD, et CDF aux seuls restes CDF. Aucun total USD+CDF ni conversion implicite n'est acceptable. Les dettes soldées contribuent zéro ; les bornes sont inclusives pour ≥ et exclusives pour <.

## Validation encore nécessaire

Tests ciblés : 0/10/30/50/100, plusieurs années, paiement partiel, dette soldée, bornes exactes, devises, curseurs au-delà de la première page, refus des élèves étrangers et des parents. Le verdict runtime doit encore être établi sur le SHA final déployé ; aucun PASS E2E ne découle de ces seuls tests. Aucun changement Production.
