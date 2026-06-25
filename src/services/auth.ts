import { doc, getDoc } from "firebase/firestore";
import { auth, db, firebaseReady } from "../firebase";
import type { AppData, AppUser, Role } from "../types";

interface FirebaseAuthModule {
  signInWithEmailAndPassword: (authInstance: unknown, email: string, password: string) => Promise<{ user: { uid: string; email: string | null } }>;
  signOut: (authInstance: unknown) => Promise<void>;
}

export async function signIn(email: string, password: string, data: AppData) {
  if (firebaseReady && auth && db) {
    const authModule = (await import("firebase/auth")) as unknown as FirebaseAuthModule;
    const credential = await authModule.signInWithEmailAndPassword(auth, email, password);
    const userSnapshot = await getDoc(doc(db, "users", credential.user.uid));

    if (!userSnapshot.exists()) {
      throw new Error("Aucun profil Acadéa n'est associé à ce compte.");
    }

    return { id: credential.user.uid, ...userSnapshot.data() } as AppUser;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const demoUser = data.users.find((user) => user.email.toLowerCase() === normalizedEmail && user.demoPassword === password);

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

export function canEnterRoute(user: AppUser | null, route: string) {
  if (!user) return false;
  if (route === "/platform") return user.role === "super_admin";
  if (route === "/dashboard") return user.role === "school_admin" && Boolean(user.schoolId);

  return false;
}

export function validateSchoolAdmin(user: AppUser) {
  return user.role === "school_admin" && Boolean(user.schoolId);
}

export function validatePlatformAdmin(user: AppUser) {
  return user.role === "super_admin";
}

export function getDefaultRoute(role: Role) {
  return role === "super_admin" ? "/platform" : "/dashboard";
}
