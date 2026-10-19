# Cotations consolidées, publication et archives

Cette évolution réutilise `api/manage-teacher-grading.js` : aucune nouvelle fonction Vercel n'est ajoutée. Les écritures pédagogiques et la publication passent par ce serveur après vérification du jeton Firebase, du rôle, de l'école et de l'année. Les collections `gradeEntries`, `courseGradingConfigs`, `gradePublicationRuns` et `publishedGradeResults` restent inaccessibles directement aux clients selon les règles Firestore existantes.

## Maxima et palmarès

Un nouveau maximum est identifié par école, année, classe opérationnelle, matière et évaluation. Le maximum de cette évaluation a priorité sur l'ancien maximum global ; ce dernier reste lisible et n'est pas réécrit. Une absence de cote reste `null`, jamais zéro. Pour une évaluation complète, le pourcentage est la somme des cotes divisée par la somme des maxima applicables, multipliée par 100. Une évaluation incomplète n'a ni pourcentage ni rang. Les ex æquo partagent leur rang et le rang suivant est sauté (1, 1, 3). Le classement est limité à la classe opérationnelle, sans fusion d'options distinctes.

## Publication

Le Directeur des études sélectionne une évaluation et, facultativement, un seuil de pourcentage et/ou de montant payé pour un type de frais. Les deux filtres sont combinés par `ET`. Le montant est comparé en unités monétaires entières avec la devise de l'année ; une devise absente ou discordante empêche la publication. Les paiements annulés ou remboursés ne comptent pas. Les lignes retenues reçoivent un instantané ne contenant que l'évaluation publiée. Le parent lit cet instantané exclusivement par l'API, qui revérifie son profil et le lien avec l'enfant à chaque demande. Les notifications internes sont créées dans la même transaction que la publication ; elles ne contiennent ni note, ni pourcentage, ni montant. Un identifiant de demande stable rend les répétitions techniques idempotentes. Une nouvelle publication est une nouvelle demande ; le retrait invalide les accès du lot concerné.

Les sources pédagogiques et les paiements sont lus avant la transaction d'écriture. Une modification simultanée de ces sources pendant ce court intervalle peut rendre l'instantané transitoirement obsolète ; cette limite doit être évaluée en recette avant promotion. Aucun parent ne reçoit pour autant les autres périodes ou les autres élèves.

## Archives

Le drawer « Année Scolaire » appelle une API de lecture seule. Il liste uniquement les années de l'école marquées `archived`, puis renvoie un résumé borné selon le rôle : classes pédagogiques, paiements/dépenses, enfants encore liés, affectations de l'enseignant, discipline de son périmètre ou dossiers administratifs. Les endpoints de cotation et de publication refusent les nouvelles écritures sur une année archivée. Les historiques originaux ne sont ni déplacés ni recalculés.

## Déploiement et retour arrière

Déployer d'abord un Preview configuré exclusivement pour `acadea-staging`, vérifier `/version.json`, la connexion, les six rôles, la publication et les refus d'accès avec des données fictives, puis nettoyer ces fixtures. Les nouvelles collections n'exigent pas de règle de lecture client : elles sont servies uniquement par l'API authentifiée. En cas d'anomalie avant promotion, laisser l'alias officiel inchangé. Aucun retour arrière ne doit effacer les documents de publication ou les historiques financiers.
