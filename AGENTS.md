# Consignes pour les agents (Codex et autres)

Ces règles s'appliquent à **tout agent** qui travaille sur Acadéa. Claude Code lit les mêmes règles dans `CLAUDE.md`.

## Langue
- Écrire **toujours en français** : messages, rapports, descriptions de PR, messages de commit, journaux.
- Le propriétaire n'est pas développeur : employer un français simple.

## Version de l'application et mise en production (obligatoire)
- L'application affiche sa version (par exemple « Version 1.4.2 ») sous « Déconnexion », dans le Menu de chaque rôle. Le numéro vient de `package.json`.
- **Règle de numérotation :**
  - **dernier chiffre** : correction (1.4.2 → 1.4.3) ;
  - **chiffre du milieu** : nouvelle fonctionnalité (1.4.2 → 1.5.0) ;
  - **premier chiffre** : grand changement (1.4.2 → 2.0.0).
- **Dans chaque PR vers `main`**, avant de demander la mise en production :
  ```bash
  node scripts/release/version-bump.mjs <correction|fonctionnalite|majeur> "Description simple du changement"
  ```
  Cette commande augmente le numéro (`package.json`, `package-lock.json`) et ajoute la section du changement en tête de `CHANGELOG.md`, la liste versionnée des changements.
- **Le contrôle GitHub `version-check` refuse la PR** si le numéro n'a pas été augmenté selon la règle ou si `CHANGELOG.md` n'est pas complété.
- **Toute mise en production passe par une seule procédure :**
  ```bash
  bash scripts/release/ship-lot.sh <numéro de PR>
  ```
  Elle fait, dans l'ordre :
  1. elle attend que tous les contrôles soient verts ;
  2. elle vérifie la version et `CHANGELOG.md` ;
  3. elle fusionne la PR, construit la version et fait 9 vérifications **avant** la mise en ligne ;
  4. elle met en ligne, puis refait 9 vérifications ;
  5. elle donne la commande de retour arrière et note la version dans le journal.

  Elle s'arrête au moindre échec. Ne jamais mettre en ligne autrement.
- Un lot peut aller en production dès qu'il est prêt, à n'importe quelle heure, à condition que toutes ces sécurités soient respectées.
- **Une seule mise en ligne à la fois**, toujours.
- **Règle des 15 minutes (19/11) :** une session qui attend le message d'une autre depuis plus de 15 minutes n'attend plus. Elle vérifie elle-même :
  - qu'aucune mise en ligne ne tourne ;
  - que `main` n'a pas bougé.

  Puis elle avance sans attendre.
- Si `ship-lot.sh` s'arrête après la fusion (coupure réseau, par exemple), la mise en ligne n'est pas faite. On la reprend à l'étape 4 du script : construction, 9 vérifications, mise en ligne, 9 vérifications.

## Sécurité et données
- Ne jamais ouvrir `.env*` ni `service-account.json`.
- Ne jamais modifier une donnée de production sans l'accord explicite du propriétaire.
- Ne pas modifier les limites des opérations financières ni les limites anti-abus sans le dire au propriétaire.
- Une seule branche par lot, à partir de `main`. Pour chaque correction, écrire un test qui échoue avant et passe après.
