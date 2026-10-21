# Lisibilité des tableaux PDF — contrôle local

Tous les exports HTML vers PDF passent par `src/utils/pdf.ts` (`renderAcadPdfPreview`, `pdfTable`). L'inventaire comprend les tableaux pédagogiques (cotations, fiche consolidée, palmarès, horaires, élèves), administratifs (listes, rapports, correspondance, discipline) et financiers (paiements, arriérés, personnel et paie). Les tableaux affichés dans l'application ne sont pas concernés.

## Cause et correction

Le contenu HTML est peint par `html2canvas` dans une image PNG, puis inséré dans `jsPDF`. Le PNG est sans perte, mais les anciennes cellules à 9,5 px, les en-têtes à 8 px et le tableau consolidé à 8 px devenaient très petits sur A4. La capture fixe à l'échelle 2 pouvait aussi paraître douce à l'impression. Remplacer seulement les tableaux par du texte vectoriel impliquerait une seconde implémentation de la mise en page et de la pagination ; ce changement n'est pas introduit ici.

Les cellules standard passent à 12 px, les tableaux à six ou sept colonnes à 11 px, ceux à huit colonnes et plus à 10,5 px. Les en-têtes passent de 8 à 11 px (10,5 px pour les tableaux denses). Le tableau consolidé à dix colonnes passe de 8 à 10,5 px ; la fiche de cotation passe de 11 à 12 px. La résolution de capture vise une échelle 3 et une aire de 36 millions de pixels ; pour les très longs documents, elle ne descend pas sous l'échelle 2 existante et peut donc dépasser cette aire cible. Les lignes ont le droit de revenir à la ligne et les tableaux longs de continuer sur des pages supplémentaires. Les en-têtes des tableaux standard sont répétés sur les pages suivantes ; les totaux restent après la dernière ligne. Le paginateur spécialisé des cotations est conservé.

Les orientations, les colonnes, les calculs, les valeurs, les permissions et les règles de filtrage ne changent pas. Le Tableau de cotes reste en A4 portrait et le PALMARÈS en paysage. Le titre de chaque cours et le début de son tableau restent sur la même nouvelle page.

## Preuves reproductibles

`e2e/pdf-table-legibility-local.spec.ts` génère, sans réseau et avec des données fictives, des PDF administratifs courts, financiers longs et larges en paysage, ainsi qu'une fiche consolidée de trois cours. Les fichiers et rendus de chaque page physique sont sous `tmp/pdfs/table-legibility/before` (source `main`) et `tmp/pdfs/table-legibility/after` (branche candidate) ; ce répertoire est ignoré par Git. Les mêmes valeurs de test sont employées avant/après. Le test vérifie les dimensions des pages physiques, l'existence de pages de continuation et l'en-tête répété. Les PNG doivent aussi être inspectés visuellement à l'échelle de la page imprimée, notamment les valeurs longues et les trois colonnes de totaux.

La comparaison locale montre qu'un tableau fictif de 45 lignes et cinq colonnes occupe deux pages avant et trois pages après : ce coût de pagination est volontaire pour conserver la lisibilité. Un tableau dense de cotations garde dix colonnes, ses maxima et ses totaux, et utilise trois pages distinctes pour trois cours courts. Aucun document réel d'école n'est utilisé.

Limite : les tableaux restent rasterisés, donc le texte n'est pas sélectionnable dans le PDF. Le plafonnement de résolution protège la mémoire mais un export exceptionnellement long peut rester moins net qu'un export court. Une migration vectorielle complète nécessiterait un chantier séparé avec vérification de tous les générateurs.
