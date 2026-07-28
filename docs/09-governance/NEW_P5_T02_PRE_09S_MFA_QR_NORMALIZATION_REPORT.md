# NEW-P5-T02-PRE-09S MFA QR Normalization Report

## Scope

- Worktree: `D:\Ai\staking-wallet-web-phase2-supervisor`
- Branch: `fix/new-p5-phase2-runtime-supervisor`
- HEAD: `9579660cce7ee52a91fd81d7dc40a2b1d991be70`
- Task scope: compare successful and failing MFA enrollment QR payload shapes safely, apply a minimal route normalization change only if the ADMIN Role path provides a valid upstream QR representation, and validate the change.
- Ignored scope: Salon ERP, Step 3-CL, P5-T02 implementation.

## PRE-09R Starting Finding

- Reference ADMIN MFA enrollment reached the route and returned HTTP 200.
- ADMIN Role MFA enrollment reached the route, passed origin/auth/AAL/upstream/factor/TOTP checks, then failed at QR shape validation.
- Initial public failure: HTTP 503 with public code `mfa_enrollment_failed`.
- PRE-09R primary cause: `APPLICATION_MFA_ROUTE_QR_SHAPE_FAILURE`.

## Safe QR Shape Comparison

No raw QR, secret, token, cookie, UUID, factor id, challenge id, or user id was copied.

| Item | Reference ADMIN MFA | ADMIN Role MFA |
| --- | --- | --- |
| Route reached | yes | yes |
| Upstream status | 200 | 200 |
| Upstream error | false | false |
| QR source path | `totp_qr_code` | `totp_qr_code` |
| QR type | `nonempty_string` | `nonempty_string` |
| QR format | `raw_svg_markup` | `raw_svg_markup` |
| Secret source path | `totp_secret` | `totp_secret` |
| Secret shape | valid | valid |

Parity result:

- QR source path parity: true.
- QR type parity: true.
- QR format parity: true.
- Secret shape parity: true.

## Decision

The ADMIN Role path supplied a valid raw SVG QR representation from the same upstream field used by the passing Reference path. The route rejected that valid representation after normalization validation. This satisfied the task condition for a minimal QR normalization fix.

Primary cause:

```text
APPLICATION_MFA_ROUTE_VALID_RAW_SVG_NORMALIZATION_REJECTED
```

## Route Change

Changed file:

```text
src/app/api/v1/auth/mfa/enroll/start/route.ts
```

Selected hunk:

- Preserve existing data URI and recognized base64 image handling.
- Detect raw SVG markup case-insensitively.
- Preserve the existing base64 SVG normalization path when it passes validation.
- Add a raw SVG UTF-8 data URI fallback only when the first normalized data URI fails existing validation.
- Keep the existing normalized QR data URI validation bounds and `data:image/` requirement.

Excluded hunk:

- No arbitrary string acceptance.
- No otpauth URI acceptance as a QR image.
- No validation removal.
- No public status, public code, response body, or diagnostic header changes.
- No package, script, Supabase, migration, or production source changes outside the route.

## Public API Contract

Unchanged:

- Success status and response fields.
- Failure status for enrollment shape failures: HTTP 503.
- Failure public code: `mfa_enrollment_failed`.
- No upstream raw error, raw QR, raw secret, or internal path is exposed.

## Marker Cleanup

- PRE-09R/PRE-09S success-path QR and secret observation markers were removed after diagnosis.
- Normal successful enrollment requests no longer emit QR/secret shape markers.
- The route keeps only minimal safe failure classification markers for upstream or response-shape failures.

## Validation

Initial source validation:

- `npm run lint`: PASS.
- `npm run build`: PASS.

Post-fix observation before marker cleanup:

- Reference ADMIN MFA: PASS.
- ADMIN Role MFA enrollment diagnostic: PASS.
- ADMIN Role enrollment status: 200.
- ADMIN Role public code: none.
- Safe QR shape parity: true.
- Safe secret shape parity: true.

Post-cleanup validation:

- `npm run lint`: PASS.
- `npm run build`: PASS.
- Reference ADMIN MFA: PASS.
- ADMIN Role MFA enrollment diagnostic: PASS.
- Normal success-path QR/secret markers: removed.

Current-code smoke:

- Enrollment smoke: 3/3 PASS.
- inactive_revoke smoke: run 1 PASS, run 2 FAIL with public result `admin_role_unavailable`.
- inactive_revoke 3/3 acceptance: not met.
- Retry count: 0.
- Assertion relaxation: 0.

Static and security gates:

- Script syntax checks: PASS.
- `npm ci`: PASS.
- `npm audit --omit=dev --json`: 0 vulnerabilities.
- `npm audit --include=dev --json`: 0 vulnerabilities.
- Package diff: 0.
- Supabase diff: 0.

Cleanup:

- Port 3000 listener: 0.
- Port 3010 listener: 0.
- Ports 55721-55724 listeners: 0.
- Current project containers: 0.
- Host port 3000 published container: 0.
- `.env.local`: absent.
- `.env.local.phase2-supervisor`: absent.

## Observer

Observer directory:

```text
D:\Ai\staking-wallet-web-pre05-snapshot\PRE09S_MFA_QR_NORMALIZATION
```

Files:

- `01-current-normalization-contract.md`
- `02-reference-qr-shape.md`
- `03-admin-role-qr-shape.md`
- `04-safe-shape-parity.md`
- `05-normalization-decision.md`
- `06-post-fix-validation.md`
- `07-runtime-cleanup-ledger.md`
- `08-sha256-manifest.txt`

## Secret Review

- Raw QR values: not recorded.
- TOTP secret values: not recorded.
- Cookies, access tokens, refresh tokens, JWTs: not recorded.
- Supabase keys, service role keys, DB URLs: not recorded.
- Private keys and mnemonics: not present.

## Final Status

```text
REQUIRES_ACTION
```

Reason:

- The MFA QR normalization mismatch is fixed.
- Reference and ADMIN Role MFA enrollment diagnostics pass on the current route.
- Final current-code Enrollment smoke passes 3/3.
- Final current-code inactive_revoke smoke did not meet 3/3 because run 2 failed with `admin_role_unavailable`.
- P5-T02 should remain blocked until the inactive_revoke runtime/business command instability is handled in a follow-up task.
