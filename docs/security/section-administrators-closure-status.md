# PR #40 — état de finalisation du 1er novembre 2026

Ce document ne constitue pas une validation de livraison. Les connexions restent
verrouillées et la PR reste en brouillon. Aucun déploiement ni changement Firebase
distant n'a été effectué pour les lots ci-dessous.

## Registre des blocages confirmés

| ID | Composants | Défaut / correction nécessaire | État |
| --- | --- | --- | --- |
| B01 | `sectionFinancialHistory`, `sectionSchoolRecords`, `sectionAdministratorYearScope` | Les arriérés collectés dans l'année sélectionnée étaient omis. Charger séparément l'année de collecte, préserver les devises, dédupliquer et vérifier les dossiers d'origine et courant. | Corrigé : requête bornée à l'école/année, contrôles transactionnels des deux élèves et conservation de la provenance historique. |
| B02 | `useSchoolMessageRecipients` | Une réponse tardive pouvait conserver un annuaire d'un ancien utilisateur/périmètre ; une erreur conservait les contacts précédents. | Corrigé : invalidation par identité, école, année, statut et sections ; réponse ancienne ignorée ; liste vidée pendant revalidation et après refus. |
| B03 | `conversations`, `usePaginatedConversations` | Les marqueurs historiques utilisaient le compteur de l'administrateur principal par défaut. | Corrigé pour la sécurité : seuls les quatre rôles historiques propriétaires de ces compteurs peuvent les modifier. Cela ne valide pas le parcours de lecture personnel des nouveaux profils (B06). |
| B04 | `Dashboard`, `ControlModule` | Le solde général n'avait pas de consultation dédiée indépendante des commandes de dépense interdites. | Corrigé : composant partagé de consultation, sans mutation, utilisant l'API existante ; réponse école/année/devise vérifiée ; annulation des réponses obsolètes. |
| B05 | `Dashboard`, `dashboardPdf` | La synthèse financière scolaire et le PDF sont toujours bloqués pour les profils de section ; les compteurs de population reposent sur des collections volontairement incomplètes. | Ouvert : terminer les agrégats bornés et le PDF sans confondre population visible, finances scolaires de section et caisse générale. |
| B06 | `messageRecipients`, `send-parent-message`, notifications/conversations et pièces jointes | Les listes de destinataires des autres rôles n'incluent pas encore les trois nouveaux profils. Le parcours bidirectionnel, les marqueurs personnels et les fichiers ne disposent pas d'une validation intégrée complète. | Ouvert : destinataires réciproques contrôlés, parent mixte borné à la relation autorisée, lecture personnelle et téléchargement authentifié vérifiés de bout en bout. Ne pas élargir simplement les listes de rôles. |
| B07 | `MenuModule`, services documentaires | Le Menu des profils de section ne présente que les années, paramètres école et historiques. Les autres consultations légitimes ne sont pas toutes intégrées ; les lectures directes des valves restent interdites. | Ouvert : établir les consultations permises avec leurs lecteurs bornés, sans réintroduire l'administration des comptes/parents ou les mutations de comptabilité. |
| B08 | `auth`, `activeUser`, règles Firebase et recette | Les gardes de livraison refusent encore les trois rôles. Aucun parcours authentifié de leurs cinq onglets n'a été exécuté. | Ouvert : finaliser les chemins autorisés puis préparer une recette isolée qui conserve les contrôles métier. Une CI E2E historique verte ne prouve pas cette recette. |

Huit blocages confirmés dans ce registre, quatre corrections techniques effectuées,
quatre blocages de finalisation ouverts. Ce décompte ne certifie pas l'absence de
défauts supplémentaires dans les parcours authentifiés encore non exécutés.

## Vérifications réellement exécutées sur les nouveaux lots

- Historique/transport/périmètre annuel : **29 tests PASS** (quatre fichiers).
- Annuaire asynchrone, compteurs historiques et non-régression messagerie :
  **15 tests PASS** (trois fichiers, dont les tests de refus des trois profils).
- Consultation de caisse générale : **6 tests PASS**, dont rendu React statique,
  refus de compte désactivé/sections absentes et réponses étrangères.
- ESLint ciblé et `git diff --check` : **PASS**.
- La CI du commit `03c81c3` a trouvé un type trop large dans une fixture de test ;
  corrigé au commit `254f335` avec un tuple littéral. Ce résultat FAIL n'est pas
  assimilé à une validation du nouveau HEAD.
- Pas de recette Firebase Staging hébergée, pas de test mobile, pas de preuve
  visuelle PDF nouvelle, pas de parcours authentifié des trois profils.

Les tests ci-dessus utilisent des données synthétiques et des doubles de transport
ou de base ; ils ne sont pas une recette Firestore hébergée. Le rendu React statique
ne démontre pas les effets asynchrones d'un navigateur.

## Garde-fous conservés

- Pas d'activation des connexions, de fusion ou de déploiement.
- Pas de modification de règles Firestore/Storage dans ces lots.
- Aucune donnée réelle ni ressource Firebase distante créée, modifiée ou supprimée.
- Les suppressions d'élève, annulations/suppressions de paiement et opérations
  d'administration des utilisateurs restent interdites.
- La comptabilité générale n'est jamais ventilée artificiellement par section.

**Verdict : PR non prête pour validation finale / livraison.**
