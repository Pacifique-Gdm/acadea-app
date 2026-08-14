import { initializeApp } from "firebase/app";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, firebaseConfig, firebaseReady } from "../firebase";
import type { AppUser, Role } from "../types";
import { markAuthStep, measureAuthStep } from "../utils/authPerformance";
import { normalizeSectionIds } from "../utils/userSections";

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

function assertFirebaseAuthReady() {
  if (!firebaseReady || !auth || !db) {
    throw new Error("Configuration Firebase requise pour l'authentification.");
  }
}

function isRole(role: unknown): role is AppUser["role"] | "admin" | "superadmin" {
  return ["super_admin", "school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher", "parent", "admin", "superadmin"].includes(String(role));
}

function normalizeUserProfile(user: RawAppUser): AppUser {
  const normalizedRole = user.role === "superadmin" ? "super_admin" : user.role === "admin" ? "school_admin" : user.role;
  const normalizedSchoolId = user.schoolId ?? user.tenantId ?? user.organisationId ?? user.organizationId;

  return {
    ...user,
    role: normalizedRole,
    schoolId: normalizedSchoolId,
    sectionIds: normalizeSectionIds(user.sectionIds ?? []),
    section: normalizeSectionIds(user.section ? [user.section] : [])[0],
  } as AppUser;
}

export function mergeRealtimeUserProfile(resolvedUser: AppUser, profile: Record<string, unknown>): AppUser {
  return normalizeUserProfile({
    ...resolvedUser,
    ...profile,
    id: resolvedUser.id,
    role: resolvedUser.role,
    schoolId: resolvedUser.schoolId,
  } as RawAppUser);
}

export const AUTH_BOOTSTRAP_WATCHDOG_MS = 15_000;

function resolveFirebaseUserProfile(firebaseUser: FirebaseUser, firestoreDocument: Record<string, unknown>, claims: Record<string, unknown>) {
  assertFirebaseAuthReady();

  if (!isRole(claims.role)) {
    throw new Error("Connexion refusée : le rôle Firebase Custom Claims est manquant ou invalide.");
  }

  if (["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher", "admin"].includes(String(claims.role)) && typeof claims.schoolId !== "string") {
    throw new Error("Connexion refusée : le Custom Claim schoolId est manquant.");
  }

  if (claims.role === "parent" && (typeof claims.schoolId !== "string" || typeof claims.parentId !== "string")) {
    throw new Error("Connexion refusée : les Custom Claims parent sont incomplets.");
  }

  if (firestoreDocument.status === "inactive" || firestoreDocument.active === false) {
    throw new Error("Votre compte n’est plus actif dans cet établissement.");
  }
  markAuthStep("auth:role-resolved");
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
  let profileUnsubscribe: (() => void) | undefined;
  let bootstrapWatchdog: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const stopProfileBootstrap = () => {
    profileUnsubscribe?.();
    profileUnsubscribe = undefined;
    if (bootstrapWatchdog) clearTimeout(bootstrapWatchdog);
    bootstrapWatchdog = undefined;
  };

  const failBootstrap = (error: unknown, expectedGeneration: number) => {
    if (generation !== expectedGeneration) return;
    generation += 1;
    stopProfileBootstrap();
    onError(error);
  };

  markAuthStep("auth:subscribe-start");
  const authUnsubscribe = authModule.onAuthStateChanged(
    auth,
    (firebaseUser) => {
      generation += 1;
      const currentGeneration = generation;
      stopProfileBootstrap();
      markAuthStep("auth:state-resolved");
      measureAuthStep("auth:state-wait", "auth:subscribe-start", "auth:state-resolved");
      if (!firebaseUser) {
        onUser(null);
        return;
      }

      markAuthStep("auth:identity-start");
      markAuthStep("auth:profile-listener-start");
      const claimsPromise = authModule.getIdTokenResult(firebaseUser)
        .then((result) => {
          markAuthStep("auth:claims-loaded");
          measureAuthStep("auth:claims-wait", "auth:identity-start", "auth:claims-loaded");
          return result.claims;
        })
        .catch(() => ({} as Record<string, unknown>));
      let resolvedUser: AppUser | undefined;
      let initialResolution: Promise<void> | undefined;

      bootstrapWatchdog = setTimeout(() => {
        failBootstrap(new Error("La vérification de la session Firebase a expiré. Vérifiez votre connexion puis réessayez."), currentGeneration);
      }, AUTH_BOOTSTRAP_WATCHDOG_MS);

      profileUnsubscribe = onSnapshot(doc(db!, "users", firebaseUser.uid), (snapshot) => {
        if (generation !== currentGeneration) return;
        const profile = snapshot.data();
        if (!snapshot.exists()) {
          console.error("[Acadéa auth] Profil utilisateur introuvable.", { code: "auth/profile-not-found" });
          failBootstrap(new Error("Aucun profil Acadéa n'est associé à ce compte."), currentGeneration);
          void authModule.signOut(auth);
          return;
        }
        if (profile?.status === "inactive" || profile?.active === false) {
          failBootstrap(new Error("Votre compte n’est plus actif dans cet établissement."), currentGeneration);
          void authModule.signOut(auth);
          return;
        }
        if (resolvedUser) {
          onUser(mergeRealtimeUserProfile(resolvedUser, profile ?? {}));
          return;
        }
        if (initialResolution) return;
        markAuthStep("auth:profile-loaded");
        measureAuthStep("auth:profile-wait", "auth:profile-listener-start", "auth:profile-loaded");
        initialResolution = claimsPromise.then((claims) => {
          if (generation !== currentGeneration) return;
          resolvedUser = resolveFirebaseUserProfile(firebaseUser, profile ?? {}, claims);
          if (bootstrapWatchdog) clearTimeout(bootstrapWatchdog);
          bootstrapWatchdog = undefined;
          markAuthStep("auth:identity-ready");
          measureAuthStep("auth:identity-total", "auth:identity-start", "auth:identity-ready");
          onUser(resolvedUser);
        }).catch((error) => {
          failBootstrap(error, currentGeneration);
          void authModule.signOut(auth);
        });
      }, (error) => failBootstrap(error, currentGeneration));
    },
    (error) => {
      generation += 1;
      stopProfileBootstrap();
      onError(error);
    },
  );
  return () => { generation += 1; stopProfileBootstrap(); authUnsubscribe(); };
}

export function canEnterRoute(user: AppUser | null, route: string) {
  if (!user) return false;
  if (user.status === "inactive" || user.active === false) return false;
  if (route === "/platform") return user.role === "super_admin";
  if (route === "/studies") return user.role === "study_director" && Boolean(user.schoolId);
  if (route === "/teacher") return user.role === "teacher" && Boolean(user.schoolId);
  if (route === "/dashboard") return ["school_admin", "cashier", "discipline_director", "secretary"].includes(user.role) && Boolean(user.schoolId);

  return false;
}

export function validateSchoolAdmin(user: AppUser) {
  return user.role === "school_admin" && Boolean(user.schoolId) && user.status !== "inactive" && user.active !== false;
}

export function validateSchoolStaff(user: AppUser) {
  return ["school_admin", "cashier"].includes(user.role) && Boolean(user.schoolId) && user.status !== "inactive" && user.active !== false;
}

export function validateDisciplineDirector(user: AppUser) {
  return user.role === "discipline_director" && Boolean(user.schoolId) && user.status !== "inactive" && user.active !== false;
}

export function validateStudyDirector(user: AppUser) {
  return user.role === "study_director" && Boolean(user.schoolId) && user.status !== "inactive" && user.active !== false;
}

export function validateTeacher(user: AppUser) {
  return user.role === "teacher" && Boolean(user.schoolId) && user.status !== "inactive" && user.active !== false;
}

export function validateSecretary(user: AppUser) {
  return user.role === "secretary" && Boolean(user.schoolId) && user.status !== "inactive" && user.active !== false;
}

export function validateParent(user: AppUser) {
  return user.role === "parent" && Boolean(user.schoolId) && Boolean(user.parentId) && user.status !== "inactive" && user.active !== false;
}

export function validatePlatformAdmin(user: AppUser) {
  return user.role === "super_admin";
}

export function getDefaultRoute(role: Role) {
  if (role === "super_admin") return "/platform";
  if (role === "study_director") return "/studies";
  if (role === "teacher") return "/teacher";
  return "/dashboard";
}
