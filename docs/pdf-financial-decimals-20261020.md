# Pagination des fiches consolidées et précision financière

## PDF « Tableau de cotes »

L'export partagé par le Directeur des études et l'Enseignant titulaire regroupe les tableaux par classe opérationnelle. Chaque classe ultérieure commence sur une nouvelle page. Un tableau long est découpé entre les lignes : le nom de l'établissement, l'année, la classe, le cours et les en-têtes de colonnes sont rappelés sur les pages de continuation. Le PALMARÈS n'utilise pas cette pagination spécialisée.

## Montants USD et CDF

Le schéma Firestore reste numérique, sans migration. Les deux devises utilisées par Acadéa emploient actuellement deux décimales dans les champs financiers et les validations serveur. À chaque frontière de calcul, un montant valide est transformé en centièmes entiers ; les sommes, soldes et comparaisons sont effectués sur ces entiers. La conversion vers un nombre Firestore ou affiché n'intervient qu'à la sortie. Aucun arrondi supplémentaire n'est appliqué pendant les additions ou soustractions. Les valeurs ayant plus de deux décimales, les valeurs non finies et les totaux hors de l'intervalle des entiers sûrs sont rejetés, sans être ramenés à zéro.

La saisie accepte une virgule ou un point décimal et les espaces comme séparateurs de milliers. Un point ou une virgule n'est jamais interprété comme séparateur de milliers ; une chaîne ambiguë reste visible dans le champ puis échoue à la validation. Les véritables dettes de 0,01 restent dues. Les valeurs historiques numériques valides sont lues sans réécriture. Aucun taux de change ni remise active n'a été trouvé dans les parcours modifiés : les devises restent séparées et aucune conversion implicite n'est introduite.

## Limites de validation

Le PDF local utilise une école et des élèves fictifs. Les tests financiers utilisent des données fictives, des mocks ou les émulateurs ; aucune écriture financière réelle n'est nécessaire. La validation de paiements décimaux sur un backend Firebase Staging distant isolé reste distincte de ces contrôles locaux et ne doit pas utiliser les données des établissements existants.
