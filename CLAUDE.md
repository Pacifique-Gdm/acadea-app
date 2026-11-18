# Consignes pour Claude Code

Les règles communes à tous les agents (langue, version, mise en production, sécurité) sont dans **`AGENTS.md`**. Elles s'appliquent entièrement à Claude Code.

En résumé, pour la version et la mise en production :
- **Dans chaque PR :**
  ```bash
  node scripts/release/version-bump.mjs <correction|fonctionnalite|majeur> "Changement"
  ```
  - correction : dernier chiffre ;
  - fonctionnalité : chiffre du milieu ;
  - grand changement : premier chiffre.

  La commande complète aussi `CHANGELOG.md`. Le contrôle GitHub `version-check` refuse sinon la PR.
- **Mise en production, uniquement par :**
  ```bash
  bash scripts/release/ship-lot.sh <PR>
  ```
  Elle exige des contrôles verts et fait 9 vérifications avant et 9 après la mise en ligne. Le retour arrière est donné ; arrêt au moindre doute.
- **Langue :** toujours écrire en français simple (messages, PR, commits, journaux).
- **Toujours répondre en français, sans exception :** chaque message à l'utilisateur est en français, même les messages courts pendant le travail (« je lance les tests… »), les questions, les boutons, les résumés de fin de tour et les comptes rendus des autres sessions. Jamais une phrase en anglais. Seuls les commandes, les noms de fichiers et le code restent tels quels.
