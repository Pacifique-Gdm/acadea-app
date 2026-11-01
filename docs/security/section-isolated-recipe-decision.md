# Décision environnement isolé — 2 novembre 2026

La nouvelle instruction remplace la cible de recette hébergée acadea-staging
par un projet Firebase de test distinct, à créer après approbation de facturation.
Ne pas exécuter les anciens workflows de fixture sur acadea-staging.

## Vérifications effectuées

- Aucun projet Acadéa distinct de recette identifié dans la liste retournée.
- Un compte de facturation ouvert est accessible, sans rattachement effectué.
- Cloud Storage pour un nouveau bucket et le déploiement Functions nécessitent
  Blaze. Les builds, stockage d'artefacts et transferts peuvent être facturés ;
  aucune gratuité garantie. Aucun montant précis n'est établi avant dimensionnement.
- Quota de création non confirmé : le groupe gcloud beta quotas n'est pas
  disponible dans l'installation non interactive. Ne pas prétendre que le quota
  est suffisant. Vérification à compléter avant création, sans activer de service
  payant ni augmenter de quota implicitement.
- Aucune création de projet, modification de facturation ou attribution de droits
  de suppression au projet Staging existant.

## GitHub : méthode sans fusion

Le workflow `section-isolated-recipe-contract.yml` utilise l'événement push sur
la seule branche candidate. Il exécute uniquement les tests de contrat locaux,
sans identité Google ni données distantes. Il démontre le déclenchement sans
workflow_dispatch et sans modification de main.

Après création du projet approuvé, un job hébergé pourra utiliser ce même
événement avec environnement protégé, reviewer obligatoire et WIF restreint au
nouveau projet, dépôt, branche, workflow et événement push. Ne pas réutiliser
implicitement la fédération actuelle, limitée à workflow_dispatch/acadea-staging.
Le workflow de récupération devra aussi être adapté à push et au projet isolé.

## Travail conditionné par l'approbation

Créer un projet exclusivement fictif, vérifier sa propriété et son quota,
rattacher la facturation seulement après accord, puis configurer Auth/Firestore/
Storage/Functions et une identité de recette sans accès aux projets existants.
Adapter les gardes actuellement figées sur acadea-staging à l'identifiant réel
créé, de manière explicite et fermée ; aucun identifiant de projet n'est inventé.
Ne pas autoriser arbitrairement tout projet fourni par variable d'environnement.

Les prérequis du Preview restent à vérifier ; aucune session CLI Vercel valide
n'a été démontrée par les chemins de configuration examinés. Aucun jeton affiché.

Références :
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://firebase.google.com/docs/functions/get-started
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push

Les tests hébergés restent NON EXÉCUTÉS. PR #40 en brouillon, aucune fusion.
