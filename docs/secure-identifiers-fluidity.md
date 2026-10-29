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
Security gate passed on Linux run `40948646907`: firebase-rules (Firestore/Storage, including collisions) and offline-emulator-e2e succeeded. Application lint found one unused test argument, corrected in `e00916e`.

Global TypeScript passed locally after correcting the conditional-write token accessor to use the existing auth service. Nine additional targeted tests passed (persistence feedback, teacher subscription readiness, conditional writes). Full CI is required on the final combined HEAD.

## Interface changes

- P1: generic persistence has pending/acknowledged/failure feedback, including unavailable-backend failure; network effects are outside React state updaters. `persist:false` remains local only. Discipline settings no longer report a local-only fallback as saved.
- P2: student PDF generation is awaited and locked; discipline export, financial receipts and Parent receipts expose busy/error states and prevent duplicate actions.
- Teacher documents wait for all initial subscriptions, expose error/retry and per-document action locks. No speculative subscription dependency optimisation.
- Study vacation saves use per-class locks, without changing period configuration logic.
- Offline queue distinguishes loading from empty and guards stale reads; no IndexedDB purge or financial idempotency changes.
- Super Admin quota refresh failures retain the known value with warning/retry. Coordination/sub-coordination reserve the measured results height during loading without showing old-scope rows. Visual shift reduction still requires browser measurement before claiming a measured improvement.

The new browser checks cover authenticated menu smoke tests for ten roles and the real discipline component's pending/error/retry/double-click lifecycle. Existing authenticated student-PDF/cash and offline suites remain required; smoke tests do not replace exhaustive per-role workflow validation.

## Delivery constraints

No Production data or configuration changes. No merge or deployment authorized.
No rules have been changed. Existing browser clients using manual student edits require a refresh after a coordinated API/frontend release.
Keep previous resources, historical IDs, offline IndexedDB queues and financial receipt keys. Do not use a rollback that restores unsafe overwrite behavior; prefer a compatible correction.

Production build is intentionally blocked on a feature branch by `verifyProductionBranch.cjs`; do not fake branch metadata to bypass it. CI performs the official Staging build using non-secret build-only configuration. A Production build is a post-approval integration gate.

Delivery: coordinate frontend/API (manual student edit intent), retain existing rules, verify deployment SHA, then smoke-check without real-data writes. No identifier migration or rule deployment is needed. Prefer forward fixes for security regressions; any frontend rollback must preserve offline queues and cannot restore collision overwrites. Hosted Firebase and mobile-PWA behaviour are not inferred from emulator results.
