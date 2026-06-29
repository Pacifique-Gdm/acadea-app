import { randomUUID } from "node:crypto";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const allowedPlans = new Set(["Starter", "Standard", "Premium"]);

function getCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  return applicationDefault();
}

function initAdmin() {
  if (getApps().length === 0) {
    initializeApp({ credential: getCredential() });
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function buildAcronym(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function uid(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function subscriptionAmount(plan) {
  if (plan === "Starter") return 29;
  if (plan === "Premium") return 99;
  return 49;
}

function publicError(error) {
  const code = error?.code ?? "";
  if (code === "auth/email-already-exists") return "Cet email Firebase est déjà utilisé.";
  if (code === "auth/invalid-email") return "Email administrateur invalide.";
  if (code === "auth/invalid-password") return "Mot de passe administrateur invalide.";
  return "Provisionnement impossible. Vérifiez les informations et réessayez.";
}

async function cleanup({ auth, db, adminUid, refs }) {
  const tasks = [];
  if (adminUid) tasks.push(auth.deleteUser(adminUid));
  for (const ref of refs) tasks.push(db.doc(ref).delete());
  await Promise.allSettled(tasks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Méthode non autorisée." });
    return;
  }

  let adminUid = "";
  const createdRefs = [];
  let adminAuth;
  let adminDb;

  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

    if (!token) {
      sendJson(res, 401, { error: "Authentification requise." });
      return;
    }

    const { auth, db } = initAdmin();
    adminAuth = auth;
    adminDb = db;

    const caller = await auth.verifyIdToken(token, true);
    if (caller.role !== "super_admin") {
      sendJson(res, 403, { error: "Action réservée au super administrateur." });
      return;
    }

    const body = await readBody(req);
    const schoolName = String(body.schoolName ?? "").trim();
    const adminEmail = String(body.adminEmail ?? "").trim().toLowerCase();
    const adminPassword = String(body.adminPassword ?? "");
    const plan = allowedPlans.has(body.subscriptionPlan) ? body.subscriptionPlan : "Standard";

    if (!schoolName || !adminEmail || adminPassword.length < 6) {
      sendJson(res, 400, { error: "Nom d'école, email admin et mot de passe valide sont requis." });
      return;
    }

    const schoolId = uid("school");
    const yearId = uid("year");
    const auditId = uid("audit");
    const now = new Date().toISOString();
    const amount = subscriptionAmount(plan);

    const school = {
      id: schoolId,
      name: schoolName,
      address: "",
      phone: "",
      email: adminEmail,
      currency: "USD",
      activeSchoolYearId: yearId,
      logoUrl: "",
      acronym: buildAcronym(schoolName),
      educationLevels: ["Primaire"],
      schoolType: "Mixte",
      createdAt: now,
      status: "active",
      subscriptionPlan: plan,
      subscriptionStatus: "active",
      subscriptionAmount: amount,
    };
    const year = {
      id: yearId,
      schoolId,
      name: "2026-2027",
      startsAt: "2026-09-01",
      endsAt: "2027-07-15",
      status: "active",
    };

    await db.doc(`schools/${schoolId}`).set(school);
    createdRefs.push(`schools/${schoolId}`);
    await db.doc(`schoolYears/${yearId}`).set(year);
    createdRefs.push(`schoolYears/${yearId}`);

    const adminUserRecord = await auth.createUser({
      email: adminEmail,
      password: adminPassword,
      displayName: `Admin ${schoolName}`,
      disabled: false,
    });
    adminUid = adminUserRecord.uid;

    const adminUser = {
      id: adminUid,
      name: `Admin ${schoolName}`,
      email: adminEmail,
      role: "school_admin",
      schoolId,
      activeSchoolYearId: yearId,
      status: "active",
      createdAt: now,
    };

    await db.doc(`users/${adminUid}`).set(adminUser);
    createdRefs.push(`users/${adminUid}`);
    await auth.setCustomUserClaims(adminUid, { role: "school_admin", schoolId });

    const auditLog = {
      id: auditId,
      schoolId,
      actorId: caller.uid,
      actorName: caller.email ?? "Super administrateur",
      action: `Création de l'école ${schoolName}`,
      createdAt: now,
    };
    await db.doc(`auditLogs/${auditId}`).set(auditLog);

    sendJson(res, 200, {
      school,
      schoolYear: year,
      adminUser,
      auditLog,
    });
  } catch (error) {
    if (adminAuth && adminDb) {
      await cleanup({ auth: adminAuth, db: adminDb, adminUid, refs: createdRefs });
    }
    console.error("[Acadéa provisioning] Provisionnement école/admin échoué.", error);
    sendJson(res, 500, { error: publicError(error) });
  }
}
