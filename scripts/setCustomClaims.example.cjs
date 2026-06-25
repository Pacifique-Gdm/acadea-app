/**
 * Exemple Firebase Admin SDK pour définir les custom claims Acadéa.
 *
 * Préparation:
 * 1. Installer firebase-admin dans un environnement sécurisé:
 *    npm install firebase-admin
 * 2. Télécharger une clé de compte de service Firebase:
 *    Firebase Console > Project settings > Service accounts > Generate new private key
 * 3. Définir la variable:
 *    set GOOGLE_APPLICATION_CREDENTIALS=C:\chemin\service-account.json
 *
 * Utilisation:
 *    node scripts/setCustomClaims.example.cjs UID super_admin
 *    node scripts/setCustomClaims.example.cjs UID school_admin school_abc123
 */

const admin = require("firebase-admin");

const [uid, role, schoolId] = process.argv.slice(2);
const allowedRoles = new Set(["super_admin", "school_admin", "cashier", "parent"]);

if (!uid || !role || !allowedRoles.has(role)) {
  console.error("Usage: node scripts/setCustomClaims.example.cjs <uid> <role> [schoolId]");
  console.error("Roles: super_admin, school_admin, cashier, parent");
  process.exit(1);
}

if (role !== "super_admin" && !schoolId) {
  console.error("schoolId est obligatoire pour school_admin, cashier et parent.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const claims = role === "super_admin" ? { role } : { role, schoolId };

admin
  .auth()
  .setCustomUserClaims(uid, claims)
  .then(() => {
    console.log(`Custom claims définis pour ${uid}:`);
    console.log(JSON.stringify(claims, null, 2));
    console.log("Demandez à l'utilisateur de se déconnecter puis reconnecter.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
