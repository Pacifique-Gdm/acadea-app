import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const allowedRoles = new Set(["school_admin", "cashier", "discipline_director", "parent"]);

function getCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")));
  }

  if (process.env.NODE_ENV !== "production" && existsSync("service-account.json")) {
    return cert(JSON.parse(readFileSync("service-account.json", "utf8")));
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

function uid(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function publicError(error) {
  const code = error?.code ?? "";
  if (code === "auth/email-already-exists") return "Cet email Firebase est deja utilise.";
  if (code === "auth/invalid-email") return "Email invalide.";
  if (code === "auth/invalid-password") return "Mot de passe invalide.";
  return "Provisionnement impossible. Verifiez les informations et reessayez.";
}

async function cleanup({ auth, db, authUid, refs }) {
  const tasks = [];
  if (authUid) tasks.push(auth.deleteUser(authUid));
  for (const ref of refs) tasks.push(db.doc(ref).delete());
  await Promise.allSettled(tasks);
}

async function assertAuthorizedCaller({ db, caller, schoolId }) {
  if (caller.role !== "school_admin" && caller.role !== "super_admin") {
    throw Object.assign(new Error("Action reservee a un administrateur autorise."), { statusCode: 403 });
  }

  if (caller.role === "school_admin" && caller.schoolId !== schoolId) {
    throw Object.assign(new Error("Action refusee pour cette ecole."), { statusCode: 403 });
  }

  const schoolSnapshot = await db.doc(`schools/${schoolId}`).get();
  if (!schoolSnapshot.exists) {
    throw Object.assign(new Error("Ecole introuvable."), { statusCode: 400 });
  }
}

async function createAuthUser(auth, { email, password, displayName }) {
  return auth.createUser({
    email,
    password,
    displayName,
    disabled: false,
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Methode non autorisee." });
    return;
  }

  let createdAuthUid = "";
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
    const body = await readBody(req);
    const role = normalizeText(body.role);
    const schoolId = normalizeText(body.schoolId);
    const schoolYearId = normalizeText(body.schoolYearId);
    const name = normalizeText(body.name);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const phone = normalizeText(body.phone);
    const address = normalizeText(body.address);
    const now = new Date().toISOString();

    if (!allowedRoles.has(role)) {
      sendJson(res, 400, { error: "Role a provisionner invalide." });
      return;
    }

    if (!schoolId || !schoolYearId || !name || !email || password.length < 6) {
      sendJson(res, 400, { error: "Ecole, annee scolaire, nom, email et mot de passe valide sont requis." });
      return;
    }

    await assertAuthorizedCaller({ db, caller, schoolId });

    const authUser = await createAuthUser(auth, {
      email,
      password,
      displayName: name,
    });
    createdAuthUid = authUser.uid;

    if (role === "school_admin" || role === "cashier" || role === "discipline_director") {
      const schoolUser = {
        id: authUser.uid,
        name,
        email,
        role,
        schoolId,
        activeSchoolYearId: schoolYearId,
        phone,
        status: "active",
        active: true,
        createdAt: now,
      };

      await db.doc(`users/${authUser.uid}`).set(schoolUser);
      createdRefs.push(`users/${authUser.uid}`);
      await auth.setCustomUserClaims(authUser.uid, { role, schoolId });

      sendJson(res, 200, { user: schoolUser });
      return;
    }

    const parentId = normalizeText(body.parentId) || uid("parent");
    const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(normalizeText).filter(Boolean) : [];
    const status = body.status === "inactive" ? "inactive" : "active";
    const parent = {
      id: parentId,
      schoolId,
      schoolYearId,
      userId: authUser.uid,
      fullName: name,
      phone,
      email,
      address,
      studentIds,
      status,
    };
    const parentUser = {
      id: authUser.uid,
      name,
      email,
      role: "parent",
      schoolId,
      activeSchoolYearId: schoolYearId,
      parentId,
      studentIds,
      status,
      phone,
      address,
      createdAt: now,
    };

    await db.doc(`parents/${parentId}`).set(parent);
    createdRefs.push(`parents/${parentId}`);
    await db.doc(`users/${authUser.uid}`).set(parentUser);
    createdRefs.push(`users/${authUser.uid}`);
    await auth.setCustomUserClaims(authUser.uid, { role: "parent", schoolId, parentId });

    sendJson(res, 200, { parent, user: parentUser });
  } catch (error) {
    if (adminAuth && adminDb) {
      await cleanup({ auth: adminAuth, db: adminDb, authUid: createdAuthUid, refs: createdRefs });
    }

    const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
    console.error("[Acadea provisioning] Provisionnement compte ecole echoue.", error);
    sendJson(res, statusCode, { error: statusCode === 500 ? publicError(error) : error.message });
  }
}
