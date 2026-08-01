# NEW-P5-T03-09 ACL Edge Remediation Report

## 1. Status

Status: PASS

Final status: PASS_CUSTODY_BALANCE_OBSERVER_ACL_EDGE_REMEDIATION_READY

## 2. Worktree / Branch / HEAD

Worktree: D:\Ai\staking-wallet-web

Branch: feat/p5-t03-custody-observer-runtime

Start HEAD: 83edd3ca39fd492a62a8bd544f7a966d2c673c13

Final HEAD: 83edd3ca39fd492a62a8bd544f7a966d2c673c13

Upstream: origin/feat/p5-t03-custody-observer-runtime

origin/main: f327ad817787a636ee50d5ddb9c8f11bdb4a3125

## 3. PR #5 Metadata

Repository: paul-IM-78/fix-new-p5-phase2-runtime-supervisor

PR: #5

State: OPEN

Draft: false

Base: main

Head: feat/p5-t03-custody-observer-runtime

Head SHA: 83edd3ca39fd492a62a8bd544f7a966d2c673c13

Merged at: null

## 4. Final Remote Review Findings

Finding 1: column-level table ACL privileges were not covered by the closed-world worker assertion.

Finding 2: effective PUBLIC schema CREATE privileges were not covered for non-system schemas.

## 5. Column-Level Privilege Defect

The previous assertion checked relation-level table privileges with `has_table_privilege()`.

PostgreSQL can grant SELECT, INSERT, UPDATE, and REFERENCES on individual columns without granting the table-level privilege, so a column-only grant could give the worker direct object access while bypassing the existing table-level assertion.

## 6. PostgreSQL Column ACL Model

Column privileges are stored separately from relation-level ACLs and can be effective through direct role grants, PUBLIC grants, or role membership.

The remediation treats every public/private table, partitioned table, view, materialized view, and foreign table as closed-world for worker column access.

## 7. Effective Column Privilege Remediation

The new forward-only migration redefines `private.assert_custody_observer_worker_role_contract()` and adds effective column privilege checks using `has_any_column_privilege()`.

Covered privileges:

- SELECT
- INSERT
- UPDATE
- REFERENCES

Each privilege is checked both directly and with grant option.

## 8. Direct Column Grant Tests

The new pgTAP file creates transaction-local public fixtures and verifies direct column-level SELECT, INSERT, UPDATE, and REFERENCES grants fail with SQLSTATE 42501 and safe message `custody_observer_worker_role_contract_invalid`.

Each grant is revoked immediately and the assertion is verified to pass again.

## 9. Column Grant-Option Tests

The new pgTAP file verifies SELECT, INSERT, UPDATE, and REFERENCES column grants with `WITH GRANT OPTION` fail closed.

Each grant-option fixture is revoked and followed by a passing assertion.

## 10. PUBLIC Column Privilege Test

The new pgTAP file grants SELECT on a public fixture column to PUBLIC and verifies the worker's effective column privilege is detected and rejected.

The PUBLIC grant is revoked and the assertion passes again.

## 11. PUBLIC Schema CREATE Defect

The previous schema catalog check detected direct `custody_observer_worker` schema ACL contamination and schema grant options, but it did not evaluate effective CREATE privileges inherited from PUBLIC.

`GRANT CREATE ON SCHEMA public TO PUBLIC` would therefore make object creation possible for the worker without a direct worker ACL entry.

## 12. Effective Schema CREATE Remediation

The new assertion checks every non-system schema with `has_schema_privilege('custody_observer_worker', schema_oid, 'create')` and `create with grant option`.

Excluded schemas:

- pg_catalog
- information_schema
- pg_toast family
- pg_temp family

PUBLIC `USAGE ON SCHEMA public` remains outside the defect scope; PUBLIC `CREATE ON SCHEMA public` is now rejected.

## 13. Public Schema Contamination Test

The new pgTAP file grants CREATE on schema public to PUBLIC and verifies the assertion fails with SQLSTATE 42501 and safe message `custody_observer_worker_role_contract_invalid`.

The grant is revoked immediately and the assertion passes again.

## 14. Synthetic Schema Contamination Test

The new pgTAP file creates a transaction-local synthetic schema, grants CREATE to PUBLIC, verifies failure, revokes the grant, verifies recovery, and drops the schema before rollback.

## 15. Existing Assertion Checks Preserved

The migration preserves the existing closed-world checks:

- worker role existence
- LOGIN and NOINHERIT
- no SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, or BYPASSRLS
- role membership restrictions
- object, function, type, and schema ownership 0
- database CONNECT required
- CONNECT grant option forbidden
- database CREATE forbidden
- direct TEMP and TEMP grant option forbidden
- private schema USAGE required
- private schema USAGE grant option forbidden
- schema CREATE forbidden
- atomic command EXECUTE required
- worker atomic EXECUTE grant option forbidden
- unexpected atomic command grantees forbidden
- public project function EXECUTE 0
- unrelated private function EXECUTE 0
- public/private table privilege 0
- public/private sequence privilege 0
- primitive EXECUTE 0
- assertion function worker EXECUTE 0
- public, anon, authenticated, and service_role observer command EXECUTE 0

Atomic command remains:

`private.record_balance_observation_and_advance_checkpoint(uuid, text, text, numeric, timestamptz, bigint, text, timestamptz)`

## 16. DB Files / Tests / Failures / Skips

db:reset:local run 1: PASS

db:lint:local run 1: PASS, error 0, warning 0

db:test:local run 1: PASS

db:types:local: PASS

db:reset:local run 2: PASS

db:lint:local run 2: PASS, error 0, warning 0

db:test:local run 2: PASS

DB files/tests/failures/skips: 30 files / 1387 tests / failure 0 / skip 0

## 17. Repeated Reset

Repeated reset/lint/pgTAP: PASS

## 18. Generated Types

Generated type diff: 0

## 19. Runtime Case Counts

Adapter runtime: 74 cases PASS

Worker runtime: 62 cases PASS

Resilience runtime: 62 cases PASS

## 20. Lint / Build / Custody Boundary

node --check adapter harness: PASS

node --check worker harness: PASS

node --check resilience harness: PASS

lint: PASS, warning 0

build: PASS

custody boundary: PASS

## 21. Audits

Production audit: 0 vulnerabilities

Full audit: 0 vulnerabilities

## 22. Network / Credential Counts

External provider/network calls: 0

Provider network calls: 0

Credential environment reads: 0

## 23. Cleanup

Supabase stop: PASS

Project Supabase containers: 0

Ports 3000/3010/55721-55724: listener 0

PostgreSQL sockets: 0

Fixture table residue: 0

Fixture schema residue: 0

Column ACL residue: 0

PUBLIC CREATE residue: 0

Role/ACL contamination residue: 0

`.env.local` diff: 0

package-lock diff: 0

## 24. Secret Scan

Secret scan scope:

- supabase/migrations/20260802003000_p5_t03_acl_edge_remediation.sql
- supabase/tests/database/p5_t03_acl_edge_remediation.test.sql
- docs/09-governance/NEW_P5_T03_09_ACL_EDGE_REMEDIATION_REPORT.md
- full working-tree diff

Actual secret findings: 0

The report contains no `.env.local` content.

## 25. Changed Files

New migration:

supabase/migrations/20260802003000_p5_t03_acl_edge_remediation.sql

New pgTAP:

supabase/tests/database/p5_t03_acl_edge_remediation.test.sql

New governance report:

docs/09-governance/NEW_P5_T03_09_ACL_EDGE_REMEDIATION_REPORT.md

Existing files modified: 0 expected

## 26. Git Status

Working tree: 3 untracked P5-T03-09 files

Staging: empty

## 27. Commit / Push / PR Status

Commit: not performed

Push: not performed

PR body/title/review/merge: not modified

## 28. Next Step

After validation passes, explicitly stage and commit only the three P5-T03-09 files in a separate commit, then push the branch and update PR #5 if requested.

## 29. Final Status

Final status: PASS_CUSTODY_BALANCE_OBSERVER_ACL_EDGE_REMEDIATION_READY
