# Phase 2 — Répartition des frais, préparation uniquement

Base : phase 1 fusionnée par la PR #51 (`431170f55fce0278a2b7e48ae900c98e96244266`).

## Périmètre livré par cette branche

- Drawer partagé dans Menu pour Administrateur, Caissier, Coordinateur et Sous-coordinateur.
- Un filtre Frais / Classe / Période, valeur dépendante, export de la même projection.
- Contexte scolaire existant ; année active et devise déterminées par le serveur. Sommes CDF et USD séparées, jamais converties.
- Administrateur seul : sélection d'un frais exact et de ses classes-options, rubriques mixtes libres, aperçu par tarif, sauvegarde atomique de brouillons, reprise, préparation de versions immuables.
- Les autres rôles consultent et exportent seulement les écoles autorisées par leurs profils et relations actifs.
- Aucun encaissement, dépense, paie, recouvrement, solde d'ouverture ou file hors connexion n'est modifié par ces parcours.

## Sémantique honnête des indicateurs

« Prévu » est ici la somme des tarifs de référence configurés, **un tarif par cible**, et non une multiplication par les effectifs ou un calcul net des réductions sociales. Cette limite est affichée dans le drawer et le PDF. Encaissé, Dépensé et Disponible restent explicitement indisponibles ; aucun zéro de trésorerie n'est inventé.

La période filtre la date de préparation du brouillon. Le libellé explicatif précise qu'il ne s'agit pas d'encaissements. « Cette année scolaire » couvre les configurations de l'année active ; aucun filtre d'année ou devise supplémentaire n'est ajouté. Les contrats de phase 1 conservent les lectures historiques par année/configuration/version pour les futurs parcours d'arriérés.

## Contrats et sécurité

`fee-allocation.get-workspace` réutilise les contrôles de phase 1 et renvoie uniquement tarifs et configurations de l'école/année autorisée.

`fee-allocation.save-drafts` est une transaction multi-cibles (1 à 50 tarifs distincts par demande) : rôle et compte actifs revérifiés, année courante, même frais de référence, identifiants exacts de classe-option, révisions optimistes, calcul entier, audit et reçu idempotent. Toute cible invalide annule le lot entier. Les clients ne fournissent ni montant de tarif ni devise ni école de destination. Un refus confirmé reste distinct d'une réponse perdue ; cette dernière conserve le même identifiant de demande et verrouille la saisie pendant la vérification.

Les écritures clientes directes des collections de répartition restent interdites. Aucune règle, index ni Function supplémentaire par rapport à la phase 1 n'est nécessaire pour cette interface. Les règles/index de phase 1 restent un prérequis avant un futur déploiement coordonné ; ils ne sont pas publiés par cette mission.

La création et la modification restent préparatoires. `activate`, `publish-configuration` et toute activation financière restent refusés. Les versions préparées ne sont pas réécrites lors de la modification d'un brouillon.

## Limites A et B avant activation

A : la clé de ligne d'un mouvement est `rubricId` au sein d'un mouvement source/révision/version unique. Les doublons, y compris `UNALLOCATED`, sont refusés ; la conservation des sommes utilise BigInt. Aucun mouvement réel n'est créé.

B : le helper serveur **non exposé comme endpoint** `inspectFeeAllocationOpeningEvidence` lit transactionnellement les pièces référencées, contrôle école/année/devise/date/montant/statut et références scolaires, calcule une empreinte et refuse les justificatifs insuffisants. Il ne crée rien et ne renvoie jamais une approbation. Le rapprochement exhaustif de caisse (paies, autres recettes, annulations, allocations antérieures et exhaustivité des pièces) demeure indispensable en phases 3–5. Un contrôle d'un sous-ensemble de pièces ne prouve pas la disponibilité globale : `eligibleForReview:false`, `approved:false`, `activationBlocked:true` restent explicites.

## Validation et livraison

Tests unitaires des calculs, transactions, permissions, idempotence et PDF ; recette Chromium authentifiée sur émulateurs avec vrais composants et handler, quatre rôles, réponse perdue, versions, refus interécole, écritures Firestore directes interdites, PDF rendus et fermeture vérifiée des fixtures. Les résultats exécutés sont consignés dans la PR ; la recette émulateur n'est jamais assimilée à Firebase hébergé.

La branche ne doit pas être fusionnée ni promue en Production dans cette mission. Le retour à l'interface précédente n'exige aucune suppression : laisser les brouillons/versions/recçus intacts, garder les règles restrictives et les identifiants. Aucune purge IndexedDB, aucun changement du circuit financier actuel.
