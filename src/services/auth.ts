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

type RawAppUser = Omit<AppUser, "role" | "schoolId"> & {
  role: AppUser["role"] | "admin" | "superadmin";
  schoolId?: string;
  tenantId?: string;
  organisationId?: string;
  organizationId?: string;
};

class AuthProfileError extends Error {
  shouldSignOut: boolean;

  constructor(message: string, options: { shouldSignOut: boolean }) {
    super(message);
    this.name = "AuthProfileError";
    this.shouldSignOut = options.shouldSignOut;
  }
}

function assertFirebaseAuthReady() {
  if (!firebaseReady || !auth || !db) {
    throw new Error("Configuration Firebase requise pour l'authentification.");
  }
}

function isRole(role: unknown): role is AppUser["role"] | "admin" | "superadmin" {
  return ["super_admin", "school_admin", "cashier", "discipline_director", "parent", "admin", "superadmin"].includes(String(role));
}

function normalizeUserProfile(user: RawAppUser): AppUser {
  const normalizedRole = user.role === "superadmin" ? "super_admin" : user.role === "admin" ? "school_admin" : user.role;
  const normalizedSchoolId = user.schoolId ?? user.tenantId ?? user.organisationId ?? user.organizationId;

  return {
    ...user,
    role: normalizedRole,
    schoolId: normalizedSchoolId,
  } as AppUser;
}

function isSignOutRequired(error: unknown) {
  return error instanceof AuthProfileError && error.shouldSignOut;
}

async function loadFirebaseUserProfile(firebaseUser: FirebaseUser, authModule: FirebaseAuthModule) {
  assertFirebaseAuthReady();

  const userSnapshot = await getDoc(doc(db, "users", firebaseUser.uid)).catch(() => {
    throw new AuthProfileError("Profil Acadéa temporairement indisponible. Veuillez réessayer.", { shouldSignOut: false });
  });
  const tokenResult = await authModule.getIdTokenResult(firebaseUser).catch(() => {
    throw new AuthProfileError("Session Firebase temporairement indisponible. Veuillez réessayer.", { shouldSignOut: false });
  });
  const claims = tokenResult.claims;

  if (!userSnapshot.exists()) {
    console.error("[Acadéa auth] Document Firestore users/{uid} introuvable.", {
      firebaseUid: firebaseUser.uid,
      role: typeof claims.role === "string" ? claims.role : "missing",
      hasSchoolId: typeof claims.schoolId === "string",
      hasParentId: typeof claims.parentId === "string",
    });
    throw new AuthProfileError("Aucun profil Acadéa n'est associé à ce compte.", { shouldSignOut: true });
  }

  if (!isRole(claims.role)) {
    throw new AuthProfileError("Connexion refusée : le rôle Firebase Custom Claims est manquant ou invalide.", { shouldSignOut: true });
  }

  if (["school_admin", "cashier", "discipline_director", "admin"].includes(String(claims.role)) && typeof claims.schoolId !== "string") {
    throw new AuthProfileError("Connexion refusée : le Custom Claim schoolId est manquant.", { shouldSignOut: true });
  }

  if (claims.role === "parent" && (typeof claims.schoolId !== "string" || typeof claims.parentId !== "string")) {
    throw new AuthProfileError("Connexion refusée : les Custom Claims parent sont incomplets.", { shouldSignOut: true });
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
        if (isSignOutRequired(error)) {
          void authModule.signOut(auth).finally(() => onError(error));
          return;
        }
        onError(error);
      });
    },
    onError,
  );
}

export function canEnterRoute(user: AppUser | null, route: string) {
  if (!user) return false;
  if (route === "/platform") return user.role === "super_admin";
  if (route === "/dashboard") return ["school_admin", "cashier", "discipline_director"].includes(user.role) && Boolean(user.schoolId);

  return false;
}

export function validateSchoolAdmin(user: AppUser) {
  return user.role === "school_admin" && Boolean(user.schoolId);
}

export function validateSchoolStaff(user: AppUser) {
  return ["school_admin", "cashier"].includes(user.role) && Boolean(user.schoolId);
}

export function validateDisciplineDirector(user: AppUser) {
  return user.role === "discipline_director" && Boolean(user.schoolId);
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
