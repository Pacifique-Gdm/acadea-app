# Audit ciblé des affectations des enseignants

17 octobre 2026 — lecture du code issu de `origin/main` `0c611ff5cf3d6e65b7781f3d183506de21161251`. Aucun composant d'affectation, document Firestore ou règle Firebase n'a été modifié pour cet audit.

## Résumé et portée de la preuve

| Signalement | Ce que le code démontre | Ce qui reste à vérifier |
| --- | --- | --- |
| Listes restant ouvertes après clic extérieur | Le sélecteur multiple partagé installe un écouteur `pointerdown` sur `document` et ferme si la cible n'est ni le déclencheur ni le menu porté dans `body`. | Le défaut au clic n'est pas reproduit avec le compte, le navigateur et la séquence signalés ; sa cause racine n'est donc **pas confirmée**. |
| Options introuvables malgré des options d'école configurées | `schools/{schoolId}.schoolOptions` ne crée pas à lui seul une option sélectionnable : une classe opérationnelle active portant une `classOptionKey` canonique liée à la classe parent est exigée. Le formulaire ne passe que `sourceClasses` au résolveur, pas les classes d'option synthétisées depuis les inscriptions. | Les documents `classes` et les références exactes des affectations de l'établissement concerné n'ont pas été lus ; on ne peut pas dire quel lien concret manque ou est filtré chez lui. |
| « 1ère », « 2ème » au lieu de noms de Humanités | Le libellé de la liste provient de `StudyClass.name`, lui-même issu d'une classe parente enregistrée ou d'un repli dérivé des inscriptions. Aucune conversion `1ère → 2ème Humanité` n'est prévue. | Le document source de ces deux libellés et l'identifiant correspondant ne sont pas connus ; on ne peut pas conclure à un décalage de niveau. |

Les tests existants vérifient une partie des fonctions pures, mais ne reproduisent pas les trois signalements dans le navigateur de l'établissement. Les conclusions ci-dessous distinguent donc un défaut de conception **démontré par le code** d'une attribution à ses données **non vérifiée**.

## Cartographie de l'interface et des données

`src/modules/studies/StudyTeachersModule.tsx:26-66,88-112,249-265` utilise la même interface pour « Ajouter une affectation » et « Modifier l'affectation ». Les sélecteurs « Cours », « Classes », « Options concernées » et « Titulaire » utilisent `MultiSelectDropdown` ; « Type de cours » et « Option concernée » sont des `<select>` natifs. L'édition hydrate l'ancienne portée via `openAssignment`, puis conserve une valeur historique indisponible sans inventer une nouvelle association. Un changement de classe passe par `retainAssignmentClassScopes` et retire les identifiants d'option devenus invalides.

Flux de données :

1. `src/modules/studies/studyService.ts:14-39,41-74` exige le rôle Directeur des études et l'école de l'utilisateur, puis souscrit en temps réel aux collections `classes`, `students`, `pedagogicalAssignments`, etc., filtrées par `schoolId` et `schoolYearId`. La requête des élèves applique en plus les sections autorisées. Les erreurs de lecture remontent par `onError`.
2. `src/modules/studies/useStudyData.ts:25-59` garde `sourceClasses` issues de `classes` et calcule séparément `classes` avec `canonicalOperationalClasses`. Il n'y a pas de cache applicatif supplémentaire dans ce chemin ; les données changent avec les snapshots.
3. `src/services/schoolSubclasses.ts:178-238,256-286` peut reconstruire des classes opérationnelles à partir des inscriptions historiques. `classesWithEnrolledStudents` limite ensuite les choix aux classes avec élèves inscrits, dans l'école et l'année sélectionnées.
4. `src/modules/studies/StudyTeachersModule.tsx:55-57,252-260` regroupe ces classes par parent pour afficher le champ « Classes ». Pour « Option concernée », il appelle toutefois `assignmentOptionChoices` avec la classe choisie et `data.sourceClasses`, pas avec l'ensemble de ses classes opérationnelles synthétisées.
5. `src/modules/studies/studyCourseScope.ts:24-48,53-59` retient seulement une classe d'option active de la même école/année que la base, dont `operationalBaseClassId` égale l'identifiant parent et dont `classOptionKey` commence exactement par `${classId}::`. `schoolOptions` n'intervient qu'après cette sélection, pour retrouver un libellé canonique.

Structures à distinguer : `schools/{schoolId}.schoolOptions` est un catalogue de libellés (`src/types.ts:68`) ; `classes/{id}` porte la classe parent ou opérationnelle (`parentClassId`, `classOptionKey`, `option`, `active`, école, année) ; `pedagogicalAssignments/{id}` conserve `classId`, `courseScope` et `targetOptionIds` ; `students/{id}` peut porter des indices historiques `classId`, `className`, `option`, `classOptionKey`. La possession d'un libellé dans le catalogue de l'école ne prouve donc pas que l'option est liée à chaque classe et année.

## 1. Fermeture des listes

**Attendu :** clic ailleurs ferme la liste, sans perdre les choix. **Constat rapporté :** certaines listes restent ouvertes dans les deux formulaires.

**Cause confirmée dans le code :** aucune cause du défaut au *clic* n'est démontrée. `src/components/ui/MultiSelectDropdown.tsx:19-51` écoute `document.pointerdown`, exclut explicitement le déclencheur et le menu affiché par `createPortal`, ferme avec Échap et lors de l'ouverture d'un autre sélecteur multiple. `src/components/ui/AdminDrawer.tsx:53-71` arrête `mousedown` à l'intérieur du drawer mais n'arrête pas `pointerdown`, donc n'explique pas à lui seul un clic extérieur ignoré. Les options du menu restent volontairement ouvertes après sélection pour permettre le multi-choix. Le test `src/components/ui/MultiSelectDropdown.test.ts:24-34` inspecte surtout la présence du code ; il ne simule pas le comportement navigateur.

**Hypothèses non confirmées :** séquence touch/blur sur mobile, clic sur une couche de portail non visée, confusion avec un `<select>` natif ou sélection interne prise pour un clic extérieur. Le composant ne ferme pas explicitement lors d'un `blur`/Tab, ce qui peut laisser un menu visible lors d'une navigation **au clavier**, mais ce n'est pas une preuve de l'incident au clic. Il manque une reproduction navigateur avec cible de clic, événement émis, largeur d'écran et type exact de liste. Une correction sans ces éléments risquerait de casser le multi-choix.

**Correction ultérieure recommandée, non exécutée :** test Chromium du vrai drawer (ajout et édition), instrumentation temporaire de `event.target`/`pointerdown` sans données personnelles, puis correction seulement si l'événement n'atteint pas le gestionnaire ou si la cible est classée à tort comme interne. Tester souris, tactile, Tab et Échap.

## 2. Options scolaires introuvables

**Attendu :** classe choisie → options réellement associées à cette classe. **Constat rapporté :** le catalogue d'options existe dans l'établissement, mais le formulaire affiche « Aucune option scolaire liée à … » ; en édition il avertit que l'ancienne valeur restera enregistrée. Ce message vient directement de `StudyTeachersModule.tsx:255-260` lorsque `assignmentOptionChoices` renvoie zéro choix.

**Cause structurelle confirmée :** l'algorithme ne tire pas d'associations de `school.schoolOptions`. Il exige des documents/classes d'option structurés correspondant au parent et à l'année. En outre, `StudyTeachersModule.tsx:255` ne fournit pas au résolveur les classes d'option que `canonicalOperationalClasses` a pu reconstruire depuis les élèves. Une école peut donc avoir des options configurées et des élèves inscrits dans ces options, tout en obtenant zéro choix si les documents `classes` attendus ne sont pas présents ou ne portent pas la clé canonique. Cette possibilité est reproductible par la lecture de `assignmentOptionChoices`/`optionClassesForBaseClass`; les tests existants `studyCourseScope.test.ts:9-54` démontrent l'acceptation des documents correctement liés et le refus des autres écoles, années et clés ambiguës.

**Attribution aux données signalées : non confirmée.** Il manque l'identifiant de la classe réellement sélectionnée, son `name`, `parentClassId`, son année, ses classes enfants actives, leurs `classOptionKey`, ainsi que les `targetOptionIds` de l'affectation concernée. Les règles de lecture, un snapshot incomplet ou un ancien modèle de documents restent des hypothèses pour cette école ; aucun accès aux documents réels n'a été utilisé. Il ne faut ni créer des options supplémentaires ni afficher indistinctement tout le catalogue.

**Correction ultérieure recommandée, non exécutée :** relever en lecture seule, pour l'école et l'année concernées, les identifiants parent/enfants et les clés d'option, puis tester une fixture mimant exactement ce modèle. Déterminer si le résolveur doit recevoir des classes opérationnelles synthétisées *vérifiées* ou si une association enregistrée doit être corrigée dans les données par un processus autorisé ; conserver les filtres école/année/état et l'identité canonique.

## 3. Libellés abrégés du secondaire

**Attendu :** voir le nom complet de la vraie classe, sans réinterpréter « 1ère » ou « 2ème ». **Constat rapporté :** des choix affichent seulement ces abréviations alors que l'utilisateur attend par exemple « 2ème Humanité », « 3ème Humanité ».

**Cause du rendu confirmée :** `StudyTeachersModule.tsx:252` affiche tel quel `assignmentClasses[].name`. `studyCourseScope.ts:83-101` prend d'abord le `name` du document parent si celui-ci est trouvé ; sinon le repli conserve le nom opérationnel en retirant éventuellement le suffixe d'option. `schoolSubclasses.ts:178-238` peut fabriquer ce nom à partir de `student.className`; `classesWithEnrolledStudents` peut également produire une entrée héritée à partir de ce même champ. `src/types.ts:4-21` définit les noms canoniques « 1ère Humanité », « 2ème Humanité », etc., mais ce type n'impose pas que des documents historiques portent ces libellés. Aucune règle du formulaire ne convertit un ordinal court en niveau suivant.

**Cause des deux libellés signalés : non confirmée.** Sans l'ID associé à « 1ère »/« 2ème » et le `name` des documents `classes` et `students` correspondants, on ne peut pas savoir si le parent est mal libellé, si un repli historique s'applique, ou si un autre composant a produit l'affichage. La correspondance proposée dans le signalement n'est pas une règle à déduire automatiquement.

**Lien possible avec l'anomalie 2 :** si le `classId` affiché est une identité synthétique/historique différente de celle qui préfixe `classOptionKey`, le filtre strict `${classId}::` renverra zéro option. Le partage du flux classes/identifiants est **confirmé** ; le fait que ce soit la cause commune dans l'établissement est **non vérifié**.

**Correction ultérieure recommandée, non exécutée :** tracer en lecture seule `displayedLabel → classId → parentClassId → classOptionKey → schoolYearId` pour un cas précis. Corriger la source de libellé ou la résolution parent/enfant seulement après comparaison avec le registre scolaire officiel ; ne pas appliquer de mapping ordinal spéculatif.

## Informations minimales pour lever les incertitudes

Une vérification read-only, avec compte autorisé et sans noms d'élèves, devrait produire pour **une seule** école/année et deux classes touchées : `schoolId`, `schoolYearId`, `schools.schoolOptions`, les documents `classes` parents/enfants (ID, `name`, `section`, `parentClassId`, `classOptionKey`, `option`, `active`), les seuls `students` nécessaires à identifier l'origine de `className` (IDs anonymisés), et l'affectation concernée (`classId`, `courseScope`, `targetOptionIds`). Relever aussi le résultat et toute erreur du snapshot `classes`. Aucune écriture n'est requise.

## Plan recommandé — non exécuté

1. Reproduire les deux formulaires avec les données minimales isolées puis la séquence de clic/touch rapportée ; tester l'événement extérieur avant de toucher au sélecteur.
2. Comparer, par école et année, la liste `sourceClasses`, la liste synthétisée et les clés `parent::option`; établir quelle identité manque dans l'école concernée.
3. Rendre le libellé complet à partir de sa source autorisée et résoudre l'association par identifiant canonique, sans exposer toutes les options ni écraser une ancienne affectation.
4. Ajouter des tests navigateur ajout/édition, historique, plusieurs années, classes parents/opérationnelles, options inactives, autre école, desktop/mobile/clavier.

**Aucune de ces corrections n'a été implémentée dans cette branche.**
