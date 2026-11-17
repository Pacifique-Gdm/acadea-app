# Liste des changements d'Acadéa

Règle : dernier chiffre = correction, chiffre du milieu = nouvelle fonctionnalité, premier chiffre = grand changement.
Chaque PR vers `main` ajoute sa section en tête avec `node scripts/release/version-bump.mjs <type> "Changement"`.

## [1.2.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : tâche automatique toutes les 10 minutes qui reprend tous les paiements en attente (créations, corrections et suppressions), sans dépendre d'un écran.
- Alerte (notification et badge) à l'Administrateur de l'école et au Super administrateur si un paiement reste en attente plus d'une heure.
- Contrôle chaque nuit : tout l'encaissé doit être réparti au centime près, par école, année et devise ; alerte détaillée au Super administrateur en cas d'écart.
- Garantie testée qu'un paiement n'est jamais réparti deux fois, même si plusieurs reprises se croisent.

## [1.1.1] — 2026-11-17 — Correction
- Procédure de version et de mise en production commune à tous les agents (scripts/release, CHANGELOG.md, AGENTS.md, CLAUDE.md) et contrôle GitHub version-check.

## [1.1.0] — 2026-11-17 — Fonctionnalité
- Répartition des frais : un paiement d'élève n'est plus jamais bloqué ; s'il ne peut pas être réparti tout de suite, il est mis en attente puis repris automatiquement par le serveur (juste après le paiement, avant chaque dépense ou paiement du personnel) (PR #86).
- Suppression de la pause de la répartition (PR #86).
- 11 tests de non-régression des formulaires de dépense et de paiement du personnel (PR #86).

## [1.0.0] — 2026-11-17 — Version de départ
- Numéro de version affiché sous « Déconnexion » dans le Menu de tous les rôles (PR #85).
- Base : lots 20 à 26c déjà en production (messagerie, notifications push, cas sociaux réservés à l'Administrateur, suppression des tiers, correctifs des drawers).
