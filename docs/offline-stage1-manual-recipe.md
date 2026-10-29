# Vérification manuelle courte — accès hors connexion (étape 1)

**Statut actuel : NON VÉRIFIÉ.** Cette procédure ne constitue pas à elle seule la validation de l'étape 1. N'utiliser qu'un compte et des données fictifs sur Firebase Staging ; ne rien saisir dans Acadéa Production.

1. **En ligne** : ouvrir Acadéa Staging sur l'appareil à tester, se connecter avec le compte fictif autorisé, ouvrir une page prévue pour la lecture hors connexion et attendre que les données fictives se chargent. Noter l'école et le rôle affichés.
2. **Sans réseau** : couper réellement l'accès Internet de l'appareil, fermer entièrement le navigateur, puis le rouvrir à la même adresse Staging. Ne pas se contenter d'actualiser l'onglet existant.
3. **Observer** : noter si l'application s'ouvre, si elle retrouve la session locale admissible et si seules les données fictives préchargées du bon utilisateur et de la bonne école sont visibles. Toute demande de nouvelle connexion réseau, page vide ou donnée d'une autre école est un échec à documenter ; ne pas prétendre que la session est valide par la seule présence d'un cache Firebase.
4. **Déconnexion** : si l'application s'ouvre, se déconnecter hors ligne, fermer puis rouvrir le navigateur. Les données du compte précédent ne doivent plus être accessibles. Reconnecter l'appareil à Internet et vérifier qu'une nouvelle authentification et les autorisations serveur sont exigées avant toute synchronisation.

Noter le navigateur, l'appareil, l'URL et les résultats observés pour chaque étape, sans capture de mot de passe ni de jeton. Les tests complémentaires de durée maximale de session, révocation, isolation de plusieurs comptes et synchronisation restent nécessaires avant un verdict **PASS** de l'étape 1. Les étapes 2 à 7 demeurent interdites tant que ce verdict n'est pas obtenu.
