import { initializeApp } from "firebase/app";
import { doc, getDoc } from "firebase/firestore";
import { auth, db, firebaseConfig, firebaseReady } from "../firebase";
import type { AppUser, Role } from "../types";

interface FirebaseAuthModule {
  signInWithEmailAndPassword: (authInstance: unknown, email: string, password: string) => Promise<{ user: FirebaseUser }>;
  createUserWithEmailAndPassword: (authInstance: unknown, email: string, password: string) => Promise<{ user: FirebaseUser }>;
  initializeAuth: (appInstance: unknown, options: { persistence: unknown }) => unknown;
  inMemoryPersistence: unknown;
  getIdToken: (user: unknown, forceRefresh?: boolean) => Promise<string>;
  getIdTokenResult: (user: unknown) => Promise<{ claims: Record<string, unknown> }>;
  onAuthStateChanged: (authInstance: unknown, next: (user: FirebaseUser | null) => void, error?: (error: unknown) => void) => () => void;
  sendPasswordResetEmail: (authInstance: unknown, email: string) => Promise<void>;
  signOut: (authInstance: unknown) => Promise<void>;
}

type FirebaseUser = {
  uid: string;
  email: string | null;
};

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

function assertFirebaseAuthReady() {
  if (!firebaseReady || !auth || !db) {
    throw new Error("Configuration Firebase requise pour l'authentification.");
  }
}

function isRole(role: unknown): role is AppUser["role"] | "admin" | "superadmin" {
  return ["super_admin", "school_admin", "cashier", "parent", "admin", "superadmin"].includes(String(role));
}

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

async function loadFirebaseUserProfile(firebaseUser: FirebaseUser, authModule: FirebaseAuthModule) {
  assertFirebaseAuthReady();

  const userSnapshot = await getDoc(doc(db, "users", firebaseUser.uid));
  const tokenResult = await authModule.getIdTokenResult(firebaseUser).catch(() => ({ claims: {} as Record<string, unknown> }));
  const claims = tokenResult.claims;

  if (!userSnapshot.exists()) {
    console.error("[Acadéa auth] Document Firestore users/{uid} introuvable.", {
      firebaseUid: firebaseUser.uid,
      email: firebaseUser.email,
      firestoreDocument: null,
      customClaims: claims,
    });
    throw new Error("Aucun profil Acadéa n'est associé à ce compte.");
  }

  if (!isRole(claims.role)) {
    throw new Error("Connexion refusée : le rôle Firebase Custom Claims est manquant ou invalide.");
  }

  if (["school_admin", "cashier", "admin"].includes(String(claims.role)) && typeof claims.schoolId !== "string") {
    throw new Error("Connexion refusée : le Custom Claim schoolId est manquant.");
  }

  if (claims.role === "parent" && (typeof claims.schoolId !== "string" || typeof claims.parentId !== "string")) {
    throw new Error("Connexion refusée : les Custom Claims parent sont incomplets.");
  }

  const firestoreDocument = userSnapshot.data();
  const rawProfile = {
    ...firestoreDocument,
    id: firebaseUser.uid,
    email: firebaseUser.email ?? (typeof firestoreDocument.email === "string" ? firestoreDocument.email : ""),
    role: claims.role,
    schoolId: claims.schoolId,
    parentId: claims.parentId,
    tenantId: claims.tenantId,
    organisationId: claims.organisationId,
    organizationId: claims.organizationId,
    __authDiagnostic: {
      firebaseUid: firebaseUser.uid,
      email: firebaseUser.email,
      firestoreDocument,
      customClaims: claims,
      rawRole: claims.role,
      schoolId: claims.schoolId,
      tenantId: firestoreDocument.tenantId ?? claims.tenantId,
      organisationId: firestoreDocument.organisationId ?? claims.organisationId,
      organizationId: firestoreDocument.organizationId ?? claims.organizationId,
      parentId: claims.parentId,
    },
  };

  return normalizeUserProfile(rawProfile as RawAppUser);
}

export async function signIn(email: string, password: string) {
  assertFirebaseAuthReady();

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  await authModule.signInWithEmailAndPassword(auth, email, password);
}

export async function signOutUser() {
  assertFirebaseAuthReady();

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  await authModule.signOut(auth);
}

export async function createFirebaseAuthUser(email: string, password: string) {
  assertFirebaseAuthReady();

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  const secondaryApp = initializeApp(firebaseConfig, `user-create-${crypto.randomUUID()}`);
  const secondaryAuth = authModule.initializeAuth(secondaryApp, { persistence: authModule.inMemoryPersistence });
  const credential = await authModule.createUserWithEmailAndPassword(secondaryAuth, email, password);
  await authModule.signOut(secondaryAuth);

  return credential.user.uid;
}

export async function sendPasswordReset(email: string) {
  assertFirebaseAuthReady();

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  await authModule.sendPasswordResetEmail(auth, email);
}

export async function getCurrentFirebaseIdToken() {
  assertFirebaseAuthReady();

  const currentUser = (auth as { currentUser?: unknown | null }).currentUser;
  if (!currentUser) {
    throw new Error("Session Firebase requise.");
  }

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  return authModule.getIdToken(currentUser, true);
}

export async function subscribeToFirebaseUser(
  onUser: (user: AppUser | null) => void,
  onError: (error: unknown) => void,
) {
  assertFirebaseAuthReady();

  const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
  return authModule.onAuthStateChanged(
    auth,
    (firebaseUser) => {
      if (!firebaseUser) {
        onUser(null);
        return;
      }

      void loadFirebaseUserProfile(firebaseUser, authModule).then(onUser).catch((error) => {
        void authModule.signOut(auth).finally(() => onError(error));
      });
    },
    onError,
  );
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
