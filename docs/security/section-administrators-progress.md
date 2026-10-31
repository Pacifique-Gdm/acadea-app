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

## Personnel creation and lifecycle checkpoint

- Existing personnel account form now offers all three roles and requires sections.
- Server checks configured school sections and creates Auth/profile records disabled.
- Personnel role labels, typed roles and generated email prefixes added.
- School information drawer now lists section administrators and exposes exact manual confirmations.
- Super-admin-only lifecycle API scopes targets to the selected school, disables Auth, revokes sessions and writes an audit entry. Deletion removes Auth access and preserves a tombstone for history attribution.
- Activation deliberately returns 409 until the five-tab/data security integration is validated. It is not a completed activation workflow.
- API/provisioning/policy tests: 116 passed. Credentials/routes/lifecycle tests: 45 passed (overlapping lifecycle tests). TypeScript and lint passed after fixing new-role integrations.
- Still outstanding: five-tab permissions and section-scoped queries, financial/message/history/PDF integration, emulator and browser lifecycle validation. No connections have been enabled.

## Historical arrears and shared interface filtering checkpoint

- Financial arrears single/batch readers accept section roles internally while public access remains blocked by the release gate.
- Scope is loaded from the authoritative user document inside the transaction. Empty/invalid assignments fail closed, regardless of claim sections.
- Current student and historical student records must belong to an authorized section. Cross-section ancestry and unattributed historical data reject the read before monetary details are calculated/returned.
- Existing authorized totals and USD/CDF separation are preserved. Financial regression suite: 39 tests passed; TypeScript and targeted lint passed.
- Shared UI section filters now reject empty scope, other-school records and records lacking an explicit section for the new roles. Legacy role behavior is unchanged. 11 filter tests passed.
- This is not complete financial authorization: payment/expense/cash/payroll mutations and balances remain unavailable to section roles; all five-tab, message, PDF and Firestore integrations remain pending. No activation or deployment is authorized by this checkpoint.

## Isolated Windows continuation — display boundary

- The published rebuild branch was recovered at `7c9f15b` in a separate worktree; other local worktrees and their untracked files were left intact. PR #39 remains based on PR #38, not on this branch.
- `scopeData` now routes the three new roles through a conservative, pure section-and-school filter. Explicitly attributed students, their unambiguous parents and linked payments/attendance/sanctions may appear. Unattributed, cross-section or schoolwide financial/message/history records are withheld; this is **not** a substitute for Firestore query/API authorization.
- Synthetic tests cover four sections, multiple assignments, foreign schools, missing attribution and mixed-section parents. Existing admin behavior is unchanged; the server and Firestore release guards remain in place.
- The following are still blocking release: section-scoped Firestore queries and rules, server financial mutations and balances, messaging/attachments, PDF exports, offline caches and each of the five administrator tabs. Do not activate accounts or lift either release guard on the strength of this display filter.

## Generic loader fail-closed checkpoint

- Both the initial and year-refresh Firestore loaders now reject the three section administrator roles before launching any school-wide collection query. This is a defense against accidental exposure if the authentication release gate is lifted prematurely; it does not implement the future section-scoped loaders.
- Existing `school_admin` queries remain unchanged. Focused tests verify all three roles are refused without reading a collection.

## Financial history boundary

- The shared Control history pagination now requires the current actor and refuses the three section roles before any whole-school payments, expenses or cash-inflows query. It also rejects a mismatched school for legacy roles.
- The school-wide cash-balance API and all financial mutations remain unavailable to section roles. Historical expenses and inflows have no reliable section attribution, so their values cannot safely be presented as section balances. A section-linked server history and balance contract is still required before activation; hiding rows after a global client query is not acceptable.
