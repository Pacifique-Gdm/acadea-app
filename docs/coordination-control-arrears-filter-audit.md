# Filtre Contrôle Arriérés — garde-fou avant évolution du modèle

## Constat sur le candidat de départ 8d323b02

- `api/_lib/financialTransactions.js::historicalStudentRecords` reconstruit la filiation `importedFromStudentId`, puis la compatibilité de matricule/identité, et retient les années archivées antérieures. Une filiation ambiguë est refusée.
- `historicalDebts` lit les frais et paiements des fiches historiques et calcule `max(expected - paid, 0)` dans la devise de chaque année. `listStudentArrears` et `listScopedStudentArrears` sont les sources autorisées existantes.
- Aucun champ de total historique par devise n'existe dans `Student` ni dans les index `students`. Les transactions financières ne maintiennent pas une projection requêtable de ce total sur la fiche actuelle.
- La pagination des élèves est ordonnée par `sortName`/identifiant. Ajouter deux comparaisons sur la page obtenue ne paginerait pas l'ensemble des résultats financiers.

## Ce qui n'a pas été implémenté

Les champs « Arriérés ≥ / < » ne sont pas ajoutés artificiellement à l'UI : ils ne disposent pas encore d'une source paginable respectant les contraintes de la mission. Aucun N+1 d'appels `list-arrears` par élève, aucun calcul financier copié dans le frontend, aucune migration, aucun backfill et aucun index nouveau n'ont été exécutés.

## Solutions et limite actuelle

1. Parcourir toutes les pages sources et appeler l'API canonique par élève éviterait les résultats manquants, mais introduirait précisément le N+1 interdit et un coût dépendant de tout le périmètre pour les filtres rares.
2. Une API de calcul groupé réutilisant le moteur canonique, sans projection persistante, exige un audit/une implémentation spécifique de ses lectures groupées, de la filiation et des curseurs. Elle n'est pas disponible ni validée dans ce lot. Ne pas la présenter comme impossible, ni comme déjà réalisée.
3. Une projection dérivée, indexée par école/année/devise et total restant, permettrait une requête bornée. Elle exige un changement de modèle significatif et une stratégie de réconciliation idempotente : paiement/correction/suppression, frais historiques, filiation/import, année et monnaie. Ce chantier doit s'arrêter avant une telle migration conformément à la mission.

La devise doit être explicite : comparer un montant USD aux seuls restes USD, et CDF aux seuls restes CDF. Aucun total USD+CDF ni conversion implicite n'est acceptable. Les dettes soldées contribuent zéro ; les bornes sont inclusives pour ≥ et exclusives pour <.

## Validation encore nécessaire

Une solution canonique groupée/paginable reste à concevoir et valider : 0/10/30/50/100, plusieurs années, paiement partiel, dette soldée, bornes exactes, combinaison recherche/classe/devise, page suivante/retour et isolation des quatre rôles. Le chantier 8 est **NON TERMINÉ**, pas PASS. Aucun changement Production.
