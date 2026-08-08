export function initAdmin(): { auth: unknown; db: unknown; bucket: unknown };
export function firebaseAdminPublicError(error: unknown, context?: string): { code: string; message: string; correlationId?: string };
