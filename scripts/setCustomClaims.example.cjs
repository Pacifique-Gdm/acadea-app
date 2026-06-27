/**
 * Exemple Firebase Admin SDK pour definir les custom claims Acadea.
 *
 * Preparation:
 * 1. Installer firebase-admin dans un environnement securise:
 *    npm install firebase-admin
 * 2. Telecharger une cle de compte de service Firebase:
 *    Firebase Console > Project settings > Service accounts > Generate new private key
 * 3. Definir la variable:
 *    set GOOGLE_APPLICATION_CREDENTIALS=C:\chemin\service-account.json
 *
 * Utilisation:
 *    node scripts/setCustomClaims.example.cjs UID super_admin
 *    node scripts/setCustomClaims.example.cjs UID school_admin school_abc123
 *    node scripts/setCustomClaims.example.cjs UID cashier school_abc123
 *    node scripts/setCustomClaims.example.cjs UID parent school_abc123 parent_abc123
 */

const admin = require("firebase-admin");

const [uid, role, schoolId, parentId] = process.argv.slice(2);
const allowedRoles = new Set(["super_admin", "school_admin", "cashier", "parent"]);

if (!uid || !role || !allowedRoles.has(role)) {
  console.error("Usage: node scripts/setCustomClaims.example.cjs <uid> <role> [schoolId] [parentId]");
  console.error("Roles: super_admin, school_admin, cashier, parent");
  process.exit(1);
}

if (role !== "super_admin" && !schoolId) {
  console.error("schoolId est obligatoire pour school_admin, cashier et parent.");
  process.exit(1);
}

if (role === "parent" && !parentId) {
  console.error("parentId est obligatoire pour le role parent.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const claims =
  role === "super_admin"
    ? { role }
    : {
        role,
        schoolId,
        ...(role === "parent" ? { parentId } : {}),
      };

admin
  .auth()
  .setCustomUserClaims(uid, claims)
  .then(() => {
    console.log(`Custom claims definis pour ${uid}:`);
    console.log(JSON.stringify(claims, null, 2));
    console.log("Demandez a l'utilisateur de se deconnecter puis reconnecter.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
