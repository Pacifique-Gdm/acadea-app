# Répartition des frais — plan de phase 2, sans implémentation

## Périmètre et dépendances

Un drawer « Menu → Répartition des frais » réutilisera la navigation, les composants financiers et le point d'entrée `POST /api/manage-financial-transaction` de chaque module. L'Administrateur configure les frais de son école ; le Caissier, le Coordinateur et le Sous-coordinateur consultent uniquement les écoles autorisées. Aucun flux financier actuel ne doit dépendre de ce drawer tant que les phases d'imputation, de rapprochement et d'activation ne sont pas livrées.

La phase 1 fournit `fee-allocation.get-state`, `get-permissions`, `list-configurations`, `list-versions`, `validate-draft`, `save-draft` et `prepare-version`. Chaque requête passe par le jeton Firebase, le profil actif et le périmètre serveur. La phase 2 devra réutiliser ces routes et définir séparément des lecteurs agrégés sécurisés pour les chiffres ; une somme calculée depuis des brouillons ne doit jamais être présentée comme argent disponible. Publication et activation restent refusées (`409 phase-not-ready`) tant que les phases financières ultérieures ne sont pas validées.

## Interface

La barre unique sera : **[ + Ajouter ] [ Filtre ▼ ] [ Valeur correspondante ▼ ] [ Exporter PDF ]**. « Ajouter » n'est visible que pour l'Administrateur. Le filtre unique propose Frais, Classe et Période ; la valeur dépend du choix, de l'école et de l'année active. Il n'y a ni filtre Devise, ni filtre Année scolaire, ni second tableau permanent. La devise vient de l'établissement / de l'année active.

Un seul bloc de synthèse affiche **Prévu | Encaissé | Dépensé | Disponible** ; le tableau principal affiche **Rubrique | Prévu | Encaissé | Dépensé | Disponible**. Le détail des rubriques est ouvert à la demande. Avant activation et rapprochement, les montants opérationnels doivent afficher explicitement « Indisponible — répartition en préparation », sans zéro trompeur ni chiffre fictif. Les configurations, versions et historiques préparatoires peuvent être consultés distinctement.

Le formulaire Administrateur choisit le frais exact puis une ou plusieurs classes applicables, ajoute les rubriques manuellement, sélectionne pour chacune un pourcentage ou un montant fixe, prévisualise le calcul par classe et le reste « Non affecté », puis enregistre par `save-draft` avec `requestId` stable et `expectedRevision`. L'année active et la devise sont résolues côté serveur ; les choix de classe sont validés contre les frais existants de l'école. Une classe-option doit rester distincte de la classe sans option. Une modification de tarif ou de cible impose de reprendre le brouillon.

## États, erreurs et sécurité

Chargement : squelette local au drawer, puis données confirmées ; conserver la dernière lecture visible lors d'une panne réseau. Écriture : « en cours », « confirmé » ou « confirmation incertaine » ; dans ce dernier cas, réutiliser le même `requestId` pour la réconciliation, sans créer de doublon. Afficher les erreurs 400 (saisie), 401 (session), 403 (périmètre), 409 (révision/activation), 429 (débit) et 5xx/réseau avec des messages distincts. Une absence de droit ne doit pas être masquée comme panne réseau.

L'API et les règles Firestore restent la frontière d'autorisation. Le client ne lit ni ne modifie directement les collections `feeAllocation*`. Le Caissier et les deux rôles de Coordination n'obtiennent ni bouton de mutation ni endpoint d'écriture. Les listes et PDF doivent être filtrés sur l'école et, pour la Coordination, sur les relations actives, côté serveur. Les PDF ne doivent inclure que les données effectivement autorisées ; le titre, l'année, la devise, la date et l'état préparatoire doivent être visibles. Aucun PDF de solde n'est permis avant calcul et rapprochement réels.

## Contrats à compléter avant activation

Définir les lecteurs de synthèse à partir de mouvements confirmés, jamais à partir de brouillons. Ancrer chaque créance sur son année d'origine et sur la version applicable, y compris pour les arriérés ; chaque encaissement ou annulation doit posséder une clé source/révision unique et une transaction équilibrée. Les dépenses, paies, primes, cas sociaux, paiements partiels et opérations hors connexion demandent des intégrations et tests séparés. Le solde d'ouverture exige inventaire par devise, coupure, preuves, vérification de caisse, décision d'approbation et audit ; aucune recette historique brute ne devient automatiquement disponible. Le garde du tarif doit être créé atomiquement lors d'une publication future et le changement de tarif doit créer une nouvelle version sans réécrire les anciennes.

## Critères de réussite de la phase 2

Tests unitaires : filtre dépendant, prévisualisation multi-classes, modes fixe/pourcentage, arrondis et « Non affecté ». Tests API/émulateur : rôles positifs et négatifs, école étrangère, profil désactivé, classe-option, concurrence, idempotence, ancien tarif et année inactive. Tests Chromium : drawer dans les quatre modules, chargement/erreurs/réessais, aucun bouton interdit, PDF autorisé et aucune fuite inter-écoles. Vérification de non-régression : paiements, arriérés, cas sociaux, caisse, dépenses, paie et hors connexion inchangés. La recette authentifiée hébergée reste une validation distincte. Aucune activation réelle ne fait partie de ce plan.
