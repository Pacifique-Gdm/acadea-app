#!/usr/bin/env node

/**
 * Definit les Firebase Custom Claims Acadea depuis un environnement serveur.
 *
 * Prerequis:
 * - installer firebase-admin dans cet environnement: npm install firebase-admin --save-dev
 * - definir GOOGLE_APPLICATION_CREDENTIALS vers une cle de compte de service Firebase
 *
 * Exemples:
 * node scripts/setCustomClaims.cjs --email admin@ecole.com --role school_admin --schoolId school_abc123
 * node scripts/setCustomClaims.cjs --uid firebase_uid --role super_admin
 */

const allowedRoles = new Set(["super_admin", "school_admin", "cashier", "parent"]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--")) {
      throw new Error(`Argument invalide ou manquant: ${key ?? "(vide)"}.`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`Valeur manquante pour ${key}.`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function normalizeEmail(value) {
  if (!value) return value;

  const mailtoMatch = value.match(/mailto:([^)>\s]+)/i);
  if (mailtoMatch?.[1]) return mailtoMatch[1].trim();

  const markdownMatch = value.match(/^\[([^\]]+)]/);
  if (markdownMatch?.[1]) return markdownMatch[1].trim();

  return value.trim();
}

function usage() {
  console.error("Usage:");
  console.error("  node scripts/setCustomClaims.cjs --email <email> --role <role> [--schoolId <schoolId>] [--parentId <parentId>]");
  console.error("  node scripts/setCustomClaims.cjs --uid <uid> --role <role> [--schoolId <schoolId>] [--parentId <parentId>]");
  console.error("Roles: super_admin, school_admin, cashier, parent");
}

async function main() {
  let initializeApp;
  let applicationDefault;
  let getApps;
  let getAuth;
  try {
    ({ initializeApp, applicationDefault, getApps } = require("firebase-admin/app"));
    ({ getAuth } = require("firebase-admin/auth"));
  } catch {
    throw new Error("Module firebase-admin introuvable. Installez-le avec: npm install firebase-admin --save-dev");
  }

  const args = parseArgs(process.argv.slice(2));
  const { uid, role, schoolId, parentId } = args;
  const email = normalizeEmail(args.email);

  if ((!email && !uid) || (email && uid)) {
    throw new Error("Indiquez exactement un identifiant: --email ou --uid.");
  }

  if (!allowedRoles.has(role)) {
    throw new Error("Role invalide. Roles autorises: super_admin, school_admin, cashier, parent.");
  }

  if (role !== "super_admin" && !schoolId) {
    throw new Error("schoolId est obligatoire pour school_admin, cashier et parent.");
  }

  if (role === "parent" && !parentId) {
    throw new Error("parentId est obligatoire pour le role parent.");
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS doit pointer vers la cle JSON du compte de service Firebase.");
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
    });
  }

  const auth = getAuth();
  const userRecord = uid ? await auth.getUser(uid) : await auth.getUserByEmail(email);
  const claims =
    role === "super_admin"
      ? { role }
      : {
          role,
          schoolId,
          ...(role === "parent" ? { parentId } : {}),
        };

  await auth.setCustomUserClaims(userRecord.uid, claims);

  console.log("Custom Claims Acadéa définis avec succès.");
  console.log(JSON.stringify(
    {
      uid: userRecord.uid,
      email: userRecord.email,
      claims,
    },
    null,
    2,
  ));
  console.log("Déconnectez-vous puis reconnectez-vous pour rafraîchir le token Firebase.");
}

main().catch((error) => {
  usage();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
