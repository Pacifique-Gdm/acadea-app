import { doc, getDoc } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import { auth, db, firebaseConfig, firebaseReady } from "../firebase";
import type { AppData, AppUser, Role } from "../types";

interface FirebaseAuthModule {
  signInWithEmailAndPassword: (authInstance: unknown, email: string, password: string) => Promise<{ user: { uid: string; email: string | null } }>;
  createUserWithEmailAndPassword: (authInstance: unknown, email: string, password: string) => Promise<{ user: { uid: string; email: string | null } }>;
  getAuth: (appInstance: unknown) => unknown;
  getIdTokenResult: (user: unknown) => Promise<{ claims: Record<string, unknown> }>;
  signOut: (authInstance: unknown) => Promise<void>;
}

type AuthDiagnostic = {
  firebaseUid?: string;
  email?: string | null;
  firestoreDocument?: Record<string, unknown> | null;
  customClaims?: Record<string, unknown>;
  rawRole?: unknown;
  normalizedRole?: AppUser["role"];
  schoolId?: unknown;
  tenantId?: unknown;
  organisationId?: unknown;
  organizationId?: unknown;
  parentId?: unknown;
};

type RawAppUser = Omit<AppUser, "role" | "schoolId"> & {
  role: AppUser["role"] | "admin" | "superadmin";
  schoolId?: string;
  tenantId?: string;
  organisationId?: string;
  organizationId?: string;
  __authDiagnostic?: AuthDiagnostic;
};

function normalizeUserProfile(user: RawAppUser): AppUser {
  const normalizedRole = user.role === "superadmin" ? "super_admin" : user.role === "admin" ? "school_admin" : user.role;
  const normalizedSchoolId = user.schoolId ?? user.tenantId ?? user.organisationId ?? user.organizationId;
  return {
    ...user,
    role: normalizedRole,
    schoolId: normalizedSchoolId,
    __authDiagnostic: {
      ...user.__authDiagnostic,
      rawRole: user.__authDiagnostic?.rawRole ?? user.role,
      normalizedRole,
      schoolId: normalizedSchoolId,
      tenantId: user.tenantId,
      organisationId: user.organisationId,
      organizationId: user.organizationId,
      parentId: user.parentId,
    },
  } as AppUser;
}

function getDemoFallbackUser(email: string, password: string, data: AppData) {
  const normalizedEmail = email.trim().toLowerCase();
  const demoUsers: Record<string, RawAppUser> = {
    "superadmin@acadea.demo": {
      id: "demo-superadmin",
      name: "Super Administrateur Acadéa",
      email: "superadmin@acadea.demo",
      role: "super_admin",
      demoPassword: "admin123",
      status: "active",
      __authDiagnostic: {
        firebaseUid: "demo-superadmin",
        email: "superadmin@acadea.demo",
        firestoreDocument: null,
        customClaims: {},
        rawRole: "super_admin",
      },
    },
    "admin@acadea.demo": {
      id: "demo-school-admin",
      name: "Administrateur École Demo",
      email: "admin@acadea.demo",
      role: "school_admin",
      schoolId: "school-1",
      activeSchoolYearId: "year-2025",
      demoPassword: "admin123",
      status: "active",
      __authDiagnostic: {
        firebaseUid: "demo-school-admin",
        email: "admin@acadea.demo",
        firestoreDocument: null,
        customClaims: {},
        rawRole: "school_admin",
        schoolId: "school-1",
      },
    },
  };
  const fallbackUser = demoUsers[normalizedEmail];

  if (fallbackUser && fallbackUser.demoPassword === password) {
    return normalizeUserProfile(fallbackUser);
  }

  const demoEmailAliases: Record<string, string[]> = {
    "superadmin@acadea.demo": ["admin@acadea.demo"],
    "admin@acadea.demo": ["direction@acadea.demo"],
  };
  const acceptedEmails = [normalizedEmail, ...(demoEmailAliases[normalizedEmail] ?? [])];
  const demoUser = data.users.find((user) => acceptedEmails.includes(user.email.toLowerCase()) && user.demoPassword === password);

  return demoUser ? normalizeUserProfile(demoUser as RawAppUser) : null;
}

export async function signIn(email: string, password: string, data: AppData) {
  if (firebaseReady && auth && db) {
    const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
    const credential = await authModule.signInWithEmailAndPassword(auth, email, password).catch((error) => {
      const fallbackUser = getDemoFallbackUser(email, password, data);
      if (fallbackUser) {
        console.warn("[Acadéa auth] Firebase Auth indisponible pour un compte demo, fallback local utilisé.", {
          email,
          errorCode: error instanceof Error ? error.message : error,
        });
        return null;
      }

      throw error;
    });

    if (!credential) {
      const fallbackUser = getDemoFallbackUser(email, password, data);
      if (fallbackUser) return fallbackUser;
      throw new Error("Email ou mot de passe incorrect.");
    }

    const userSnapshot = await getDoc(doc(db, "users", credential.user.uid));
    const tokenResult = await authModule.getIdTokenResult(credential.user).catch(() => ({ claims: {} as Record<string, unknown> }));
    const claims = tokenResult.claims;

    if (!userSnapshot.exists()) {
      console.error("[Acadéa auth] Document Firestore users/{uid} introuvable.", {
        firebaseUid: credential.user.uid,
        email: credential.user.email ?? email,
        firestoreDocument: null,
        customClaims: claims,
      });
      const fallbackUser = getDemoFallbackUser(email, password, data);
      if (fallbackUser) return fallbackUser;
      throw new Error("Aucun profil Acadéa n'est associé à ce compte.");
    }

    const firestoreDocument = userSnapshot.data();
    const rawProfile = {
      id: credential.user.uid,
      email: credential.user.email ?? email,
      role: claims.role,
      schoolId: claims.schoolId,
      parentId: claims.parentId,
      tenantId: claims.tenantId,
      organisationId: claims.organisationId,
      organizationId: claims.organizationId,
      ...firestoreDocument,
      __authDiagnostic: {
        firebaseUid: credential.user.uid,
        email: credential.user.email ?? email,
        firestoreDocument,
        customClaims: claims,
        rawRole: firestoreDocument.role ?? claims.role,
        schoolId: firestoreDocument.schoolId ?? claims.schoolId,
        tenantId: firestoreDocument.tenantId ?? claims.tenantId,
        organisationId: firestoreDocument.organisationId ?? claims.organisationId,
        organizationId: firestoreDocument.organizationId ?? claims.organizationId,
        parentId: firestoreDocument.parentId ?? claims.parentId,
      },
    };

    return normalizeUserProfile(rawProfile as RawAppUser);
  }

  const demoUser = getDemoFallbackUser(email, password, data);
  if (!demoUser) {
    throw new Error("Email ou mot de passe incorrect.");
  }

  return demoUser;
}

export async function signOutUser() {
  if (!firebaseReady || !auth) return;

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  await authModule.signOut(auth);
}

export async function createFirebaseAuthUser(email: string, password: string, fallbackId: string) {
  if (!firebaseReady) return fallbackId;

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  const secondaryApp = initializeApp(firebaseConfig, `parent-create-${crypto.randomUUID()}`);
  const secondaryAuth = authModule.getAuth(secondaryApp);
  const credential = await authModule.createUserWithEmailAndPassword(secondaryAuth, email, password);
  await authModule.signOut(secondaryAuth);

  return credential.user.uid;
}

export function canEnterRoute(user: AppUser | null, route: string) {
  if (!user) return false;
  if (route === "/platform") return user.role === "super_admin";
  if (route === "/dashboard") return ["school_admin", "cashier"].includes(user.role) && Boolean(user.schoolId);

  return false;
}

export function validateSchoolAdmin(user: AppUser) {
  return user.role === "school_admin" && Boolean(user.schoolId);
}

export function validateSchoolStaff(user: AppUser) {
  return ["school_admin", "cashier"].includes(user.role) && Boolean(user.schoolId);
}

export function validateParent(user: AppUser) {
  return user.role === "parent" && Boolean(user.schoolId) && Boolean(user.parentId) && user.status !== "inactive";
}

export function validatePlatformAdmin(user: AppUser) {
  return user.role === "super_admin";
}

export function getDefaultRoute(role: Role) {
  return role === "super_admin" ? "/platform" : "/dashboard";
}
