# Secure identifiers and interface feedback

Base: `9383586d397922f498269eacb17740a24328219b`.
Branch: `codex/secure-identifiers-fluidity-20261029`.

## Security checkpoint (work in progress)

- New short random resource IDs now use 16 cryptographic bytes / 32 hexadecimal characters. Existing UUID, Auth, deterministic and financial idempotency IDs are not migrated.
- School/year creation uses conditional creates. Only confirmed newly created references enter failure cleanup.
- Parent/profile creation and message/notification writes use conditional batch/transaction creates.
- Manual student saving distinguishes create/update. Missing intent is creation-only, including historical offline requests. Existing offline receipt replay remains unchanged. Old online clients must reload before editing; no existing student ID is renamed.
- Client-created documents may specify `createIds`. The REST Commit absence precondition uses the current Firebase ID token and existing security rules, without granting extra read permissions for missing documents. No retry with a different ID occurs after an uncertain network response.
- The UI retains the same generated student ID for retries of the same draft.

## Validation status

Nine targeted unit tests passed locally (generators, conditional writes, historical offline enrollment). This is not a substitute for the emulator collision/concurrency tests.
Firestore handler tests force collisions with historical IDs and retain real Firestore transactions; Auth token verification is a test adapter in this suite, not a claim of authenticated browser coverage.
Security gate passed on Linux run `40948646907`: firebase-rules (Firestore/Storage, including collisions) and offline-emulator-e2e succeeded. Application lint found one unused test argument, corrected in `e00916e`.

Global TypeScript passed locally after correcting the conditional-write token accessor to use the existing auth service. Nine additional targeted tests passed (persistence feedback, teacher subscription readiness, conditional writes). Full CI is required on the final combined HEAD.

## Interface changes

- P1: generic persistence has pending/acknowledged/failure feedback, including unavailable-backend failure; network effects are outside React state updaters. `persist:false` remains local only. Discipline settings no longer report a local-only fallback as saved.
- P2: student PDF generation is awaited and locked; discipline export, financial receipts and Parent receipts expose busy/error states and prevent duplicate actions.
- Teacher documents wait for all initial subscriptions, expose error/retry and per-document action locks. No speculative subscription dependency optimisation.
- Study vacation saves use per-class locks, without changing period configuration logic.
- Offline queue distinguishes loading from empty and guards stale reads; no IndexedDB purge or financial idempotency changes.
- Super Admin quota refresh failures retain the known value with warning/retry. Coordination/sub-coordination reserve the measured results height during loading without showing old-scope rows. Visual shift reduction still requires browser measurement before claiming a measured improvement.

The new browser checks cover authenticated menu smoke tests for ten roles and the real discipline component's pending/error/retry/double-click lifecycle. Existing authenticated student-PDF/cash and offline suites remain required; smoke tests do not replace exhaustive per-role workflow validation.

## Delivery constraints

No Production data or configuration changes. No merge or deployment authorized.
No rules have been changed. Existing browser clients using manual student edits require a refresh after a coordinated API/frontend release.
Keep previous resources, historical IDs, offline IndexedDB queues and financial receipt keys. Do not use a rollback that restores unsafe overwrite behavior; prefer a compatible correction.

Production build is intentionally blocked on a feature branch by `verifyProductionBranch.cjs`; do not fake branch metadata to bypass it. CI performs the official Staging build using non-secret build-only configuration. A Production build is a post-approval integration gate.

Delivery: coordinate frontend/API (manual student edit intent), retain existing rules, verify deployment SHA, then smoke-check without real-data writes. No identifier migration or rule deployment is needed. Prefer forward fixes for security regressions; any frontend rollback must preserve offline queues and cannot restore collision overwrites. Hosted Firebase and mobile-PWA behaviour are not inferred from emulator results.

## Finalisation PR #35 — 30 octobre 2026

Les résultats ci-dessous remplacent le checkpoint initial, sans effacer sa traçabilité.

- Sur `c9e0f0c9a4c74a8525017dafbcdfab9371e8b1e9`, la recette Chromium Linux `41002562060` passe **13/13** scénarios. Elle comprend les vrais parcours authentifiés sur émulateurs (caisse, options/élèves/PDF, créations conditionnelles, menus de dix rôles), et les composants réels soumis à des délais/erreurs contrôlés. Ces derniers ne constituent pas une recette Firebase hébergée.
- Compléments : sauvegardes indépendantes des classes, documents Enseignant (chargement/erreur/réessai/téléchargement/archivage), export élèves Administrateur et Secrétaire (double clic/attente/erreur/réessai), accusés d'enregistrement, conservation visuelle des brouillons après erreur de synchronisation.
- Coordination et Sous-coordination : déplacement de la pagination inférieur ou égal à **1 pixel CSS** entre affichage, chargement et réaffichage. Mesure en coordonnées document pour ne pas confondre saut de mise en page et défilement de Playwright. Les anciennes lignes ne restent pas visibles pendant le chargement. Preuves JSON conservées par la CI.
- Défaut reproduit et corrigé : l'erreur d'export PDF élèves était stockée dans le message du formulaire fermé. Elle dispose désormais d'une alerte visible au-dessus du tableau et est effacée lors d'un nouvel essai. Aucun changement des données ni calculs.
- Les tests de collision des handlers couvrent écoles/années, Parents, messages/notifications et nettoyage après échec ; les scénarios élèves couvrent création conditionnelle, isolation et identifiants historiques. Les suites hors connexion conservent les contrôles de conflits, doublons et files locales.
- Limites : les menus responsive ne sont pas une recette exhaustive de chaque action de chaque rôle ; pas de mesure sur appareil mobile physique ni de recette Firebase hébergée. Le Preview protégé redirige vers l'authentification Vercel ; aucune protection n'a été désactivée. La vérification directe de son SHA servi reste un prérequis de promotion.

### Livraison à autoriser séparément

1. Vérifier les CI du HEAD final et la compatibilité avec `main`, puis fusionner uniquement après autorisation.
2. Conserver l'identifiant du déploiement Production actif et ses paramètres ; aucune sauvegarde/export de données personnelles n'est nécessaire pour cette livraison sans migration.
3. Construire depuis le commit fusionné avec le workflow officiel, livrer frontend et API ensemble, vérifier SHA et routes avant promotion. Aucun déploiement de règles ou index Firebase n'est requis.
4. Demander le rechargement des anciens clients pour les modifications d'élèves (`intent: update`). Les créations historiques et opérations hors connexion restent acceptées sans migration d'identifiant.
5. Ne jamais purger IndexedDB, régénérer les clés d'idempotence ou revenir aux créations écrasantes. En cas d'incident, suspendre la promotion et privilégier un correctif compatible ; un rollback n'est admissible qu'après vérification de ces garanties, sans restauration de données scolaires ou financières.
