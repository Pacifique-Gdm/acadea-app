# Politique des artefacts temporaires

Cette politique s'applique aux diagnostics locaux, tests E2E, émulateurs, exports et credentials utilisés pour Acadéa.

## Stockage autorisé

- `tmp/`, `temp/` et `diagnostics/` peuvent recevoir uniquement des données fictives ou minimisées nécessaires à un diagnostic local.
- Aucun compte de service, token, mot de passe, clé OpenAI ou export de Production ne doit être conservé dans ces dossiers.
- Les credentials nécessaires à une session doivent rester dans le gestionnaire de secrets de l'environnement ou dans un fichier local explicitement ignoré.
- `playwright-report/`, `test-results/`, les traces, captures et journaux ne doivent jamais être versionnés.

## Rétention

- Supprimer les diagnostics locaux dès la clôture de l'incident, au plus tard après 7 jours.
- Supprimer les rapports E2E dès leur analyse, au plus tard après 24 heures s'ils contiennent une session authentifiée.
- Les exports de données réelles sont interdits sur un poste local sans validation explicite, chiffrement et durée de rétention approuvée.
- Les exports de sauvegarde officiels suivent la rétention définie dans le runbook incident et restent dans un projet ou bucket dédié, jamais dans le dépôt.

## Vérification avant commit

1. Exécuter `git status --short` et `git diff --check`.
2. Vérifier `git ls-files` pour les noms `service-account`, `credentials`, `tmp`, `test-results`, `playwright-report` et `*.log`.
3. Ne jamais utiliser `git add -f` pour contourner une règle d'exclusion de sécurité.
4. Si un secret réel a été suivi, arrêter la livraison, révoquer le secret et suivre le runbook de compromission. Une suppression locale ne suffit pas.
