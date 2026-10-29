# Secure identifiers and interface feedback

Base: `9383586d397922f498269eacb17740a24328219b`.
Branch: `codex/secure-identifiers-fluidity-20261029`.

## Security checkpoint (work in progress)

- New short random resource IDs now use 16 cryptographic bytes / 32 hexadecimal characters. Existing UUID, Auth, deterministic and financial idempotency IDs are not migrated.
- School/year creation uses conditional creates. Only confirmed newly created references enter failure cleanup.
- Parent/profile creation and message/notification writes use conditional batch/transaction creates.
- Manual student saving distinguishes create/update. Missing intent is creation-only, including historical offline requests. Existing offline receipt replay remains unchanged. Old online clients must reload before editing; no existing student ID is renamed.
- Client-created documents may specify `createIds`. The REST Commit absence precondition uses the current Firebase ID token and existing security rules, without granting extra read permissions for missing documents. No retry with a different ID occurs after an uncertain network response.
- The UI retains the same generated student ID for retries of the same draft.

## Validation status

Nine targeted unit tests passed locally (generators, conditional writes, historical offline enrollment). This is not a substitute for the emulator collision/concurrency tests.
Firestore handler tests force collisions with historical IDs and retain real Firestore transactions; Auth token verification is a test adapter in this suite, not a claim of authenticated browser coverage.
Windows dependency installation and emulator startup are slow/incomplete; global TypeScript is not yet validated. UI changes are gated on critical security tests.

## Delivery constraints

No Production data or configuration changes. No merge or deployment authorized.
No rules have been changed. Existing browser clients using manual student edits require a refresh after a coordinated API/frontend release.
Keep previous resources, historical IDs, offline IndexedDB queues and financial receipt keys. Do not use a rollback that restores unsafe overwrite behavior; prefer a compatible correction.

Remaining work: finish security/emulator validation and generic persistence review, then interface feedback changes, role-based E2E, complete CI, final single PR. This checkpoint is not ready for delivery.
