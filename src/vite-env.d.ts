/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: "development" | "staging" | "preview" | "production";
  readonly VITE_STAGING_BANNER?: string;
  readonly VITE_STAGING_LABEL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __ACADEA_BUILD_ID__: string;

declare module "jspdf" {
  export default class jsPDF {
    internal: {
      pageSize: {
        getWidth(): number;
        getHeight(): number;
      };
    };

    constructor(options?: Record<string, unknown>);
    html(
      source: HTMLElement,
      options: {
        callback: (doc: jsPDF) => void;
        margin: [number, number, number, number];
        autoPaging: "text" | "slice";
        width: number;
        windowWidth: number;
        html2canvas?: { scale?: number; useCORS?: boolean; backgroundColor?: string };
      },
    ): void;
    setFillColor(r: number, g: number, b: number): void;
    rect(x: number, y: number, width: number, height: number, style?: string): void;
    circle(x: number, y: number, radius: number, style?: string): void;
    setTextColor(r: number, g: number, b: number): void;
    setFont(fontName: string, fontStyle?: string): void;
    setFontSize(size: number): void;
    text(text: string | string[], x: number, y: number): void;
    setDrawColor(r: number, g: number, b: number): void;
    roundedRect(x: number, y: number, width: number, height: number, rx: number, ry: number, style?: string): void;
    line(x1: number, y1: number, x2: number, y2: number): void;
    addImage(imageData: string, format: string, x: number, y: number, width: number, height: number): void;
    output(type: "bloburl" | "blob"): URL | string | Blob;
    getNumberOfPages(): number;
    setPage(pageNumber: number): void;
    save(filename: string): void;
  }
}

declare module "firebase/auth" {
  export function getAuth(app?: unknown): unknown;
  export const indexedDBLocalPersistence: unknown;
  export const inMemoryPersistence: unknown;
  export function initializeAuth(app: unknown, options: { persistence: unknown }): unknown;
  export function getIdToken(user: unknown, forceRefresh?: boolean): Promise<string>;
  export function signInWithEmailAndPassword(auth: unknown, email: string, password: string): Promise<{ user: { uid: string; email: string | null } }>;
  export function createUserWithEmailAndPassword(auth: unknown, email: string, password: string): Promise<{ user: { uid: string; email: string | null } }>;
  export function onAuthStateChanged(
    auth: unknown,
    next: (user: { uid: string; email: string | null } | null) => void,
    error?: (error: unknown) => void,
  ): () => void;
  export function sendPasswordResetEmail(auth: unknown, email: string): Promise<void>;
  export function signOut(auth: unknown): Promise<void>;
}

declare module "firebase/firestore" {
  export function getFirestore(app?: unknown): unknown;
  export function doc(db: unknown, collectionName: string, id: string): unknown;
  export function collection(db: unknown, collectionName: string): unknown;
  export function query(ref: unknown, ...constraints: unknown[]): unknown;
  export function where(field: string, operator: "==", value: unknown): unknown;
  export function setDoc(ref: unknown, data: unknown): Promise<void>;
  export function deleteDoc(ref: unknown): Promise<void>;
  export function getDoc(ref: unknown): Promise<{ id: string; exists(): boolean; data(): Record<string, unknown> }>;
  export function getDocs(ref: unknown): Promise<{ size: number; docs: Array<{ id: string; ref: unknown; data(): Record<string, unknown> }> }>;
}
