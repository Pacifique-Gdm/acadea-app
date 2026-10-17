# Audit ciblé — options dans la colonne « Classe » des horaires

Date : 17 octobre 2026. Périmètre : C.S LUMBULA, année 2027‑2028, `acadea-production/(default)`, branche issue de `origin/main` `6dc96506704f774a3e2fb4808a71534223070d99`. Audit **en lecture seule** ; aucun horaire ni document Firebase modifié.

## Données réellement examinées

L'identité a été confirmée par `schools/school-210fc308` (`name = C.S LUMBULA`) et `schoolYears/school-210fc308__2027-2028` (`schoolId` correspondant). Les lectures ont été limitées aux champs techniques de 32 documents `classes`, 135 `pedagogicalAssignments`, cinq `timetables` et 1 328 `timetableEntries`, filtrés par cet établissement et cette année. Aucun élève, enseignant nominatif, note ou document financier n'a été consulté. `schoolOptions` contient sept libellés, dont « Sciences », « Littéraire » et « Commerciale et Gestion ». Les 32 classes comprennent des parents au nom court (`1ère`, `2ème`, `3ème`, `4ème`) et des documents d'option historiques au nom complet. Ces derniers portent l'option dans leur identifiant `parent::option`, mais pas dans les champs explicites `parentClassId`, `classOptionKey` ou `option`.

Le tableau actif utilise la version `v5`, `PUBLISHED`, `activePublished = true`, `persistenceState = COMPLETE` : 280 entrées. Les versions `v1` à `v4` sont des brouillons historiques ; elles ne sont pas la version affichée par défaut.

| Cas technique réel de `v5` | Classe source / option | Référence de ligne et portée | Rendu calculé par le code actuel |
| --- | --- | --- | --- |
| 23 lignes `...__1ere-humanite::sciences` | `name = 1ère Sciences` ; option déduite de `::sciences` | `classId` = classe-option ; `courseScope` et `targetOptionIds` absents dans la ligne et l'affectation | `1ère Sciences` sur une seule ligne. La seconde occurrence `sciences` est supprimée par la comparaison normalisée. **Le doublon signalé n'est pas reproduit sur ce cas avec le SHA audité.** |
| 3 lignes `...__1ere-humanite` ciblant `...__1ere-humanite::commerciale et gestion` | Parent `name = 1ère`, cible portant l'option dans son identifiant | `courseScope = option`, `targetOptionIds` présent dans la ligne et l'affectation | `1ère` en haut et `commerciale et gestion` en dessous. **L'option uniquement en seconde ligne est confirmée.** |
| 17 lignes `...__7eme-cteb` | `name = 7ème CTEB`, sans option | Aucune portée d'option | `7ème CTEB` sur une ligne. |

Les mêmes lignes parent + option existent pour « Commerciale et Gestion » en 2ème, 3ème et 4ème (trois lignes chacune), et pour « Littéraire » en 3ème (huit lignes). À l'inverse, les entrées historiques `::option` portent déjà l'option dans `name`.

## Cheminement et cause établie

1. `subscribeToStudyData` dans `src/modules/studies/studyService.ts` écoute séparément `classes`, `pedagogicalAssignments`, `timetables` et `timetableEntries`, avec filtres `schoolId`/`schoolYearId`.
2. `useStudyData` dans `src/modules/studies/useStudyData.ts` reconstruit `data.classes` par `canonicalOperationalClasses`. `operationalSchoolClasses` dans `src/services/schoolSubclasses.ts` reconnaît les identifiants historiques `::option`, déduit l'option et compose leur libellé. Les parents gardent leur nom court.
3. `StudySchedulesModule` choisit le tableau actif avec `currentStudyTimetable`, ses entrées correspondantes, puis forme `scheduleClasses` à partir des classes source, opérationnelles et logiques. Aucun regroupement des lignes ne duplique ici l'option.
4. Dans `scheduleClassPresentation`, le texte principal est **exactement** le `name` de la classe trouvée par `entry.classId`. La portée vient de la ligne si `courseScope` existe, sinon de l'affectation. `assignmentScopeLabel` (`studyCourseScope.ts`) retrouve l'option par `targetOptionIds` ou par l'identifiant historique, puis le composant rend toute option jugée absente du nom dans un `<span className="block">` secondaire.

**Anomalie 2 — cause confirmée :** deux modèles de référence coexistent dans la même version publiée : `classId` d'une classe-option à nom complet, et `classId` du parent à nom court accompagné d'un `targetOptionIds`. Le rendu suit mécaniquement le champ `name` de cette référence ; il ne fabrique pas un libellé opérationnel uniforme. Lorsque la cible n'a que l'identifiant historique, le secours `id.split("::").at(-1)` fournit en outre un slug plutôt que le libellé `schoolOptions` (« commerciale et gestion » au lieu de « Commerciale et Gestion »). Ce n'est pas une absence d'association dans ces cinq cas : la cible est bien enregistrée.

**Anomalie 1 — non confirmée sur le SHA et les documents examinés :** la version `v5` contient bien des lignes « Sciences », mais `scheduleClassPresentation` normalise et compare le nom déjà complet à la portée avant de créer la seconde ligne. Pour le cas réel `1ère Sciences`, elle renvoie une portée vide. Le commit antérieur `96f57c8` a précisément introduit cette suppression conditionnelle. Une observation authentifiée de la ligne encore double, accompagnée de son identifiant de ligne ou du bundle réellement servi, est nécessaire pour attribuer une autre cause. Il serait incorrect d'affirmer que les documents actuels produisent « Sciences / Sciences » dans ce composant. Un ancien bundle en cache ou un autre affichage restent des hypothèses, pas des conclusions.

## Portée et correction future recommandée — **non exécutée**

Les filtres « Par classe » et certains exports utilisent également les références classe/portée ; leur présentation doit être vérifiée lors d'une future correction, sans présumer qu'ils ont le même défaut. Une correction chirurgicale consisterait à construire un libellé opérationnel unique à partir de l'identifiant parent, de l'identifiant d'option et du libellé configuré, pour les deux formats historiques et récents, puis à réserver une seconde ligne explicite aux vrais cours multi-options. La déduplication devrait comparer des identifiants canoniques, pas seulement la présence textuelle d'une sous-chaîne. Aucun document historique ne doit être réécrit pour corriger une présentation.

Tests à prévoir avant une correction : classes-options historiques `parent::option` sans métadonnées ; lignes parent avec `targetOptionIds` ; libellés accentués et composés ; `common` multi-options ; sous-classes distinctes d'une option ; tableau, filtre et PDF ; autres écoles et années ; données incomplètes. Tester aussi le cas « Sciences » avec une ligne et un bundle effectivement observés si le doublon persiste.

Limite : aucune session Directeur des études Production autorisée n'a été utilisée ici ; l'affichage réel dans son navigateur n'a pas été observé. Les conclusions ci-dessus résultent des documents techniques en lecture seule et du code du SHA indiqué. Aucune modification du module Horaires n'a été faite.
