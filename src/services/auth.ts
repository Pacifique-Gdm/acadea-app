import { doc, getDoc } from "firebase/firestore";
import { initializeApp } from "firebase/app";
import { auth, db, firebaseConfig, firebaseReady } from "../firebase";
import type { AppData, AppUser, Role } from "../types";

interface FirebaseAuthModule {
  signInWithEmailAndPassword: (authInstance: unknown, email: string, password: string) => Promise<{ user: { uid: string; email: string | null } }>;
  createUserWithEmailAndPassword: (authInstance: unknown, email: string, password: string) => Promise<{ user: { uid: string; email: string | null } }>;
  getAuth: (appInstance: unknown) => unknown;
  signOut: (authInstance: unknown) => Promise<void>;
}

type RawAppUser = Omit<AppUser, "role"> & { role: AppUser["role"] | "admin" | "superadmin" };

function normalizeUserProfile(user: RawAppUser): AppUser {
  const normalizedRole = user.role === "superadmin" ? "super_admin" : user.role === "admin" ? "school_admin" : user.role;
  return { ...user, role: normalizedRole };
}

export async function signIn(email: string, password: string, data: AppData) {
  if (firebaseReady && auth && db) {
    const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
    const credential = await authModule.signInWithEmailAndPassword(auth, email, password);
    const userSnapshot = await getDoc(doc(db, "users", credential.user.uid));

    if (!userSnapshot.exists()) {
      throw new Error("Aucun profil Acadéa n'est associé à ce compte.");
    }

    return normalizeUserProfile({ id: credential.user.uid, ...userSnapshot.data() } as RawAppUser);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const demoEmailAliases: Record<string, string[]> = {
    "superadmin@acadea.demo": ["admin@acadea.demo"],
    "admin@acadea.demo": ["admin@acadea.demo", "direction@acadea.demo"],
  };
  const acceptedEmails = [normalizedEmail, ...(demoEmailAliases[normalizedEmail] ?? [])];
  const demoUser = data.users.find((user) => acceptedEmails.includes(user.email.toLowerCase()) && user.demoPassword === password);

  if (!demoUser) {
    throw new Error("Email ou mot de passe incorrect.");
  }

  return normalizeUserProfile(demoUser as RawAppUser);
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
