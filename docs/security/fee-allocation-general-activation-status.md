# Répartition générale — candidat du 13 novembre 2026

Base : `6ab7bc9e5f4cf81c9cebb1de75d15ade4a15dc94` (PR #57).
Branche : `codex/fee-allocation-general-activation-20261113`.

## Livré dans le candidat, pas en Production

- Éligibilité serveur par projet, école active, année active, devise et profil
  Administrateur stocké. Aucun nom/identifiant d'école en dur. Aucune activation
  implicite au déploiement. Les fixtures gardent leurs contrôles d'isolement.
- Parcours Administrateur : publication d'une version préparée, consultation des
  pièces, saisie explicite de l'ouverture et de la caisse constatée, approbation,
  confirmation, pause et reprise motivées. Une réponse perdue conserve la même
  clé de demande ; aucun succès optimiste.
- Une modification des pièces/configurations invalide l'approbation. Le compte
  qui confirme doit être celui qui a approuvé. Les consultations de préparation
  sont réservées à l'Administrateur, sans données d'élèves dans les preuves.
- Liaison des versions approuvées aux seuls encaissements futurs de l'année.
  Les anciens encaissements restent dans l'ouverture ; ils ne sont ni modifiés
  ni ventilés une seconde fois. Les dettes d'anciennes années ne récupèrent pas
  arbitrairement une nouvelle configuration.
- Pagination des pièces et mouvements, sans troncature à 200/2 000 lignes.
  Archivage des preuves en pages serveur, avec refus en cas de preuve incomplète.
- Conservation de la présentation PR #57 : « Selon le filtre » distinct de
  « Situation globale », avec ouverture + recettes cumulées − dépenses nettes.

## Preuves locales

- 152 exécutions Vitest ciblées réussies (11 fichiers ; certains fichiers
  réutilisent encore une fixture définie dans une suite de tests).
- Cas volumineux : 1 201 pièces d'ouverture ; 2 401 mouvements, sans troncature.
- Ancien paiement 30 + nouvel encaissement 70 : ouverture 24 et nouvelles recettes
  56 dans une rubrique à 80 %, soit 80 disponibles ; rejeu sans second mouvement.
- Refus : autre école/rôle, profil suspendu, preuve absente, approbation périmée,
  page répétée/interrompue et version ancienne non liée au rapprochement.
- TypeScript, lint et build Staging réussis sur le lot local initial ; toute
  modification ultérieure reste soumise aux contrôles de son SHA final.

## Verrous de livraison générale à lever

1. Le rapprochement reste une transaction exhaustive : l'archivage refuse une
   preuve dépassant 7 Mo/450 pages. La pagination ne suffit pas à lever les
   limites de durée/taille d'une transaction. Il faut un traitement reprenable
   avec preuve de cohérence complète, pas simplement relever les seuils.
2. Le registre est maintenant transmis en pages bornées (200 mouvements et
   500 ko par page) avec empreinte de continuité ; aucun total partiel n'est
   exposé. Sa vérification exhaustive par transaction reste toutefois coûteuse
   pour les très gros volumes et doit encore être rendue reprenable.
3. Les écritures historiques sans provenance serveur ou sans devise justifiée
   restent refusées. Aucun mécanisme ne doit fabriquer leur justification.
4. Le parcours général modifié doit encore passer sa recette hébergée : deux
   écoles activées indépendamment, une inactive, volumes, rôles, finances,
   retour réseau et quatre exports. La recette PR #57 n'est pas cette validation.

Pas de fusion ni promotion tant que ces contrôles bloquants subsistent.

## Production conservée au début de l'intervention

- SHA servi : `d46a5b499c34eeb92e10d6c36752c43dee9f3bf5`.
- Déploiement : `dpl_8VqkjKBujPUbBJR9mHkMZc2FDXN8`.
- Aucune donnée réelle, file IndexedDB, règle Production ou activation d'école
  modifiée par ce lot. Ne pas revenir à un serveur ignorant un registre actif.
