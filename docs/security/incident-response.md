# Réponse aux incidents Acadéa

Ce document est un runbook opérationnel. Il ne confirme pas l'existence d'une sauvegarde ou d'une alerte distante tant que son activation n'a pas été vérifiée dans les consoles Firebase, Google Cloud et Vercel.

## Périmètre et environnements

- Staging : Firebase `acadea-staging`, Vercel `acadea-staging`.
- Production : Firebase `acadea-production`; le projet Vercel Production doit être identifié sans ambiguïté avant toute action.
- Ne jamais réutiliser un compte de service, un export ou un secret Production en Staging.
- Toute commande doit inclure le projet explicite. Arrêter si le projet résolu ne correspond pas à l'environnement traité.

## État des mécanismes

| Mécanisme | État vérifiable dans le dépôt | Action opérationnelle |
|---|---|---|
| Authentification et Custom Claims | Existant | Firebase Auth et API Admin |
| Révocation de sessions | Disponible via Firebase Admin, non automatisée ici | Exécuter par un opérateur autorisé |
| Audit métier | Existant dans `auditLogs` et événements serveur | Préserver et exporter les événements pertinents |
| Journaux Functions/API | Existant via Google Cloud/Vercel | Configurer rétention et alertes dans les consoles |
| Sauvegarde Firestore planifiée | Non confirmée par le dépôt | À configurer et vérifier séparément |
| Sauvegarde Storage | Non confirmée par le dépôt | Activer versioning/rétention selon décision opérationnelle |
| Alertes 401/403/429 et coûts | Non configurées par le dépôt | Recommandées dans Google Cloud, Firebase, Vercel et OpenAI |

## Les 15 premières minutes

1. Désigner un responsable d'incident et ouvrir un identifiant de suivi non personnel.
2. Identifier avec certitude l'environnement, le projet Firebase et le projet Vercel affectés.
3. Conserver les journaux utiles sans copier de tokens, prompts, données médicales ou profils complets.
4. Contenir le risque : désactiver le compte ou la fonctionnalité concernée, révoquer les sessions, bloquer la clé compromise.
5. Ne supprimer aucune preuve et ne lancer aucune restauration avant d'avoir borné l'incident.
6. Vérifier les créations de comptes, changements de rôles, écritures financières, suppressions d'école, quotas IA et uploads récents.
7. Informer les responsables autorisés et consigner chaque action avec heure, opérateur et environnement.

## Scénarios

### Compte utilisateur compromis

- Détection : connexions inhabituelles, 401/403 répétés, actions incompatibles avec le rôle.
- Confinement : désactiver l'utilisateur dans Firebase Auth et dans son profil, puis révoquer ses refresh tokens via Firebase Admin `revokeRefreshTokens(uid)`.
- Preuves : conserver UID technique, horodatages, IP disponibles côté fournisseur et événements `auditLogs`; ne pas exporter le profil complet.
- Rétablissement : réinitialiser le mot de passe, vérifier les Custom Claims et réactiver seulement après validation de l'école.

### Compte Super Administrateur compromis

- Révoquer immédiatement les sessions et désactiver le compte compromis depuis un compte d'urgence distinct.
- Examiner créations/suppressions d'écoles, administrateurs, changements IA et configuration publique.
- Vérifier les accès Vercel, Firebase IAM et Google Cloud avant toute remise en service.

### Compte de service Firebase divulgué

- Désactiver ou supprimer la clé compromise dans Google Cloud IAM, sans supprimer le compte avant inventaire de ses usages.
- Créer une nouvelle clé seulement si l'authentification sans clé n'est pas disponible.
- Mettre à jour `FIREBASE_SERVICE_ACCOUNT_JSON` dans le projet Vercel exact, redéployer, valider, puis révoquer l'ancienne clé.
- Rechercher les appels Admin anormaux. Ne jamais coller la clé dans un ticket ou un journal.

### Clé OpenAI divulguée ou abus IA

- Révoquer la clé dans OpenAI, créer une clé de remplacement et mettre à jour le secret Functions `OPENAI_API_KEY`.
- Déployer uniquement les Functions IA, valider le quota et les erreurs, puis confirmer l'absence d'appel avec l'ancienne clé.
- Désactiver `aiAssistant.enabled` pour les écoles affectées si un confinement immédiat est nécessaire.

### Suppression accidentelle, ransomware ou comportement destructif

- Suspendre les comptes concernés et les endpoints destructifs si nécessaire.
- Ne pas écrire dans les collections affectées avant capture de l'étendue et du dernier point de restauration sain.
- Restaurer d'abord dans un projet de test isolé; comparer comptes, totaux, relations `schoolId`/`schoolYearId` et fichiers Storage.
- La remise en Production exige une validation métier et technique documentée.

### Abus financier

- Conserver SEC-001 : ne jamais réautoriser les écritures financières directes Firestore.
- Révoquer le compte, relever les clés d'idempotence, reçus, audits et transactions serveur concernés.
- Faire valider toute correction financière par un responsable habilité; ne jamais effacer silencieusement une transaction.

### Upload malveillant

- Désactiver l'accès du compte, isoler le chemin Storage et conserver les métadonnées minimales.
- Ne pas télécharger ni ouvrir le fichier sur un poste non isolé.
- Vérifier MIME, taille, extension et tenant; conserver SEC-002/SEC-011 et supprimer seulement après autorisation.

### Compromission Vercel, Firebase ou Google Cloud

- Révoquer les sessions administratives et credentials du fournisseur.
- Auditer membres IAM, variables Vercel, déploiements, domaines, Functions et règles publiées.
- Restaurer les permissions minimales, redéployer un commit validé et comparer les identifiants de déploiement.

## Sauvegarde et restauration

### Stratégie recommandée, non encore confirmée

- Firestore Production : export quotidien vers un bucket Production dédié, rétention recommandée de 30 jours et copies mensuelles 12 mois si la politique légale le permet.
- Staging : export hebdomadaire avec rétention courte; ne jamais y copier une sauvegarde Production non anonymisée.
- Storage : activer le versioning du bucket et une règle de cycle de vie compatible avec la politique de conservation scolaire.
- Séparer les buckets, comptes et permissions de sauvegarde entre Staging et Production.

Commandes de référence à exécuter seulement après validation du projet et du bucket :

```text
gcloud firestore export gs://BUCKET_DE_SAUVEGARDE/PREFIXE --project=PROJET_EXPLICITE
gcloud firestore import gs://BUCKET_DE_SAUVEGARDE/PREFIXE --project=PROJET_CIBLE_EXPLICITE
```

Une restauration Firestore ne restaure pas automatiquement Firebase Auth ni tous les objets Storage. Les utilisateurs Auth et les objets doivent avoir leur procédure et leur inventaire propres.

### Exercice non destructif trimestriel

1. Créer un projet Firebase de test isolé et un petit jeu de données synthétiques.
2. Exporter Firestore et copier quelques objets Storage synthétiques.
3. Supprimer uniquement les données de ce projet de test.
4. Restaurer l'export et les objets.
5. Vérifier nombres de documents, relations tenant/année, empreintes des fichiers et capacité de lecture avec les règles.
6. Documenter durée, écarts et actions correctives. Ne jamais utiliser Production comme cible d'exercice.

## Rotation des secrets

Ordre obligatoire : créer le nouveau secret, l'installer dans l'environnement exact, déployer le composant concerné, tester, puis révoquer l'ancien secret. Sont concernés : comptes de service Firebase, `OPENAI_API_KEY`, secrets Vercel et credentials CI. Ne jamais supprimer l'ancien secret avant une validation fonctionnelle du remplacement, sauf compromission active exigeant une révocation immédiate.

## Monitoring recommandé

- pics de 401/403, 429 et erreurs 5xx par endpoint;
- créations de comptes, modifications de Custom Claims et changements IAM;
- suppression d'école, suppression définitive et reprise après échec;
- écritures financières refusées ou anormales;
- resets et consommation du quota IA;
- uploads refusés, tailles et MIME anormaux;
- erreurs Functions/API et échecs de journaux d'audit;
- variations inhabituelles des coûts Firestore, Storage, Functions, Vercel et OpenAI.

Les seuils et destinataires doivent être approuvés avant configuration. Aucune alerte distante n'est créée par ce document.

## Validation et retour en service

- Vérifier les projets ciblés, le commit déployé, les règles et les variables sans afficher leurs valeurs.
- Exécuter lint, tests unitaires, tests Emulator, builds et tests de fumée non destructifs.
- Confirmer l'isolation inter-écoles, l'authentification, les permissions et l'absence d'erreur bloquante.
- Clore l'incident avec chronologie, cause, périmètre, secrets tournés, données restaurées et améliorations décidées.

## Objectifs recommandés

À faire approuver : RPO cible de 24 heures pour Firestore/Storage et RTO cible de 8 heures pour un incident majeur. Ces valeurs sont des recommandations, pas des engagements actuels.
