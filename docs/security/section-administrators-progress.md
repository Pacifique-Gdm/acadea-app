# Section administrators — implementation checkpoint

Branch: codex/section-admin-profiles-rebuild-20261031

This is an incomplete implementation, not ready for activation or deployment.

Implemented:
- Server policy identifies kindergarten_admin (Directrice Maternelle), primary_admin (Admin. Primaire), studies_prefect (Préfet d'études).
- Explicit same-school and assigned-section checks; missing/unknown sections deny access.
- Mutation policy checks both existing and proposed resource scope.
- Exact activation/deactivation/deletion confirmation policy.
- API active-user gate rejects all three roles, including stale privileged claims against a section-administrator profile.
- Firestore active-profile gate explicitly rejects these roles pending full integration. Rules have NOT been emulator-validated.
- 36 tests pass across sectionAdministrators and activeUser, including existing active-user tests.

Remaining required implementation:
1. Personnel account creation in the existing form and server provisioning, with mandatory validated school sections; initially disabled Firebase Auth accounts.
2. Super Administrator per-school management endpoints and UI, exact manual confirmations, revocation and audit trails.
3. Integrate authoritative profile scopes into every financial operation, totals, payments and history query. Do not merely filter a response after processing unrestricted data.
4. Firestore reads/writes and queries: verify school, sections and linked entities; validate old and new scope; deny unknown/unattributed records to section administrators.
5. Messages: recipients, conversations, attachments, sender scope and history; validate every recipient server-side.
6. All five administrator tabs, subscriptions, caches, histories and PDF exports must consume scoped records and fail closed on missing attribution.
7. Functions and Storage authorization, adversarial emulator tests, API tests, browser flows, lifecycle and PDF checks.
8. Only then review removing release guards. No automatic activation based on this checkpoint.

No Firebase configuration, production data, deployment or merge was performed.
