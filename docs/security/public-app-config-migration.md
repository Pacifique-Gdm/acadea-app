# Migration de la configuration publique

SEC-017 déplace les données publiques de `platform/appConfig` vers `publicConfig/appConfig`. Cette séparation est nécessaire parce que Firestore ne peut pas filtrer les champs retournés lors de la lecture d'un document.

## Données autorisées

Copier uniquement :

- `loginLogoUrl`, si la valeur est une chaîne;
- `updatedAt`, si la valeur est une chaîne.

Ne copier aucune autre propriété. Ne pas supprimer le document historique pendant cette opération.

## Procédure

1. Exécuter d'abord en Staging avec une identité Firebase Admin appartenant exclusivement à `acadea-staging`.
2. Lire `platform/appConfig` et construire manuellement un objet ne contenant que les deux clés autorisées.
3. Écrire cet objet dans `publicConfig/appConfig`.
4. Vérifier en session non authentifiée que le logo est chargé et que le document historique est refusé.
5. Déployer et valider les règles et le frontend Staging.
6. Répéter séparément en Production après approbation, en vérifiant explicitement `acadea-production`.

Cette migration est idempotente : réécrire les mêmes deux valeurs produit le même document. Elle n'est pas exécutée automatiquement par le dépôt et n'a pas été exécutée pendant la mission SEC-017.
