# NEW-P5 Legacy WIP Consolidation Plan

## Purpose

This document records the final decision for six legacy WIP preservation commits that were found across older local worktrees before the current P5 work continued.

The goal is not to merge those WIP snapshots. The goal is to prove that the work was not lost, classify what has been superseded by current `main`, identify any narrow follow-up value, and define the safe archive policy before any WIP branch is deleted.

## Current Baseline

- Worktree: `D:\Ai\staking-wallet-web`
- Branch: `chore/consolidate-pre-p5-wip`
- Baseline commit: `e4063fd7b45ff6a540187d8bca243bfd74c5d4f5`
- Baseline relationship: current `main` is the implementation baseline.
- Baseline status at analysis start: clean working tree.

The current baseline is protected as the source of truth for these areas:

- Phase 2 supervised runtime closeout.
- Local auth handoff stability.
- Local HTTP runtime boundary.
- ADMIN MFA runtime stability.
- ADMIN role fixture isolation.
- Domain and wallet runtime stability.
- P5-T02 reconciliation DB write path.
- ADMIN plus AAL2 review mutation boundary.
- HTTP error transport closeout.
- Reconciliation runtime harness.

## Protected Contracts

The following contracts must not be weakened by any future WIP consolidation work:

- Keep the current Phase 2 closeout `3/3 PASS` supervisor contract.
- Keep the P5-T02 reconciliation runtime closeout as the accepted runtime baseline.
- Do not add production service-role usage.
- Do not add private keys, mnemonics, or client-side signing.
- Do not add provider network behavior as part of this WIP consolidation.
- Do not weaken local runtime port or container cleanup ownership.
- Do not restore old Phase 2, Phase 3, or Phase 4 closeout files wholesale.
- Do not cherry-pick or merge the legacy WIP commits wholesale.

## Commit Identity Notes

Some original short references were recorded from local WIP branch names. The table below records the exact commit IDs resolved from the local branch refs at analysis time.

| WIP branch | Exact commit | Parent | Subject |
| --- | --- | --- | --- |
| `wip/pre-p5-closeout-stability-preservation` | `447b793a9f2f7d725843ddb4f03a0435fca5a2e0` | `2da951fe04603318a2e24ab0ca194e1e26e0bd34` | `wip(closeout): preserve pre-p5 runtime stability work` |
| `wip/pre-p5-closeout-orchestration-integration-preservation` | `c599f210044ea2da2fc01a498d59575c75ba3899` | `9579660cce7ee52a91fd81d7dc40a2b1d991be70` | `wip(closeout): preserve orchestration integration work` |
| `wip/pre-p5-closeout-orchestration-redesign-preservation` | `aec5272d1e1723c13f63a8272b954263df167efa` | `860f2f600104d1c0860962d52b8fcf54f4fc02d1` | `wip(closeout): preserve orchestration redesign work` |
| `wip/pre-p5-clean-runtime-preservation` | `8434e9c92c8ebd32ff51350a8019327492dbd714` | `2da951fe04603318a2e24ab0ca194e1e26e0bd34` | `wip(closeout): preserve pre-p5 clean runtime work` |
| `wip/pre-p5-sec04-runtime-preservation` | `e6832b93cb6748cc45583f1add88a90bea6103e7` | `860f2f600104d1c0860962d52b8fcf54f4fc02d1` | `wip(closeout): preserve pre-p5 sec04 runtime work` |
| `wip/pre-p5-runtime-integration-preservation` | `4921d0b63b8bb98f9025506bb83f7977c1c3b008` | `860f2f600104d1c0860962d52b8fcf54f4fc02d1` | `wip(closeout): preserve pre-p5 runtime integration work` |

## Summary Decision

- The WIP work was not lost. It is preserved in local commits and WIP branch refs.
- None of the six WIP commits should be cherry-picked or merged wholesale.
- Current `main` remains the implementation baseline.
- Three WIP commits are fully superseded or obsolete.
- Three WIP commits have partial historical or diagnostic value.
- No WIP code needs immediate integration into current `main`.
- The only optional follow-up improvement candidate is deposit staged diagnostics.
- Any optional deposit work must be manually reconstructed on top of current `main`, not restored from a WIP file.

## Commit-Level Decisions

| Commit | Work Area | Relationship To Current Main | Unique Reference Value | Integration Risk | Final Classification | Recommended Handling |
| --- | --- | --- | --- | --- | --- | --- |
| `447b793` | Runtime stability, deposit diagnostics, isolated closeout runner, Phase 2/3/4 closeout changes, PRE_03/04/04B/04C1 reports | Current Phase 2 supervisor and P5-T02 runtime closeout supersede the closeout/runtime ownership model. | Deposit stage markers, deposit failure markers, and deposit cleanup diagnostics remain useful as design input. | Restoring `isolated-closeout-runner`, Supabase start/reset ownership, or Phase 2/3/4 closeout files would risk regressing current cleanup and supervisor contracts. | `PARTIALLY_SUPERSEDED` | Preserve as reference only. Do not cherry-pick. If needed, manually reimplement deposit diagnostics on current `main`. |
| `c599f21` | Local HTTP harness, local auth handoff, closeout orchestrator, ADMIN/domain/wallet runtime cleanup, PRE_07B to PRE_08D reports | Current supervisor-based runtime and accepted local harness boundaries supersede this integration snapshot. | Pending socket/timer diagnostics and domain cleanup investigation are useful historical evidence. | Replacing the current local HTTP harness or restoring self-owned runtime cleanup would conflict with current ownership and stability model. | `PARTIALLY_SUPERSEDED` | Preserve reports as reference. Do not restore `closeout-orchestrator.local.mjs` or replace current harness behavior. |
| `aec5272` | Orchestration redesign, closeout orchestrator, local auth handoff, ADMIN/domain/phase changes, PRE_07A report | Obsolete redesign replaced by later work and current supervisor architecture. | Design history only. | Temporary `.env.local` ownership, self-owned runtime orchestration, and old cleanup model may conflict with current contracts. | `UNSAFE_OR_OBSOLETE` | Do not integrate code. Keep only commit metadata until archive decision is complete. |
| `8434e9c` | Clean runtime, ADMIN MFA, domain lifecycle, local auth handoff, Phase 2 closeout | Fully superseded by current `main` implementations for all touched areas. | None requiring code preservation. | Restoring it would revert newer verified runtime behavior. | `FULLY_SUPERSEDED` | Safe to discard after archive policy is satisfied. |
| `e6832b9` | Sec04 runtime, ADMIN MFA, ADMIN role commands, domain lifecycle, local auth handoff, Phase 2 closeout | Fully superseded by current runtime ownership, MFA preflight, and fixture isolation. | None requiring code preservation. | Restoring it would replace current safer ADMIN runtime code with older behavior. | `FULLY_SUPERSEDED` | Safe to discard after archive policy is satisfied. |
| `4921d0b` | Runtime integration, withdrawal diagnostics, ADMIN fixture isolation, Phase 2/3 ownership, PRE_06A to PRE_06I reports | Current withdrawal stabilization and Phase 2 supervisor are safer accepted implementations. | Withdrawal diagnostic modes, scenario residue diagnostics, and fixture isolation investigation may help future debugging. | Restoring WIP withdrawal or Phase 2/3 closeout code would replace validated current behavior with previously blocked integration code. | `PARTIALLY_SUPERSEDED` | Preserve as reference only. Do not restore withdrawal state machine wholesale. |

## Functional Decisions

### Keep Current Main Unchanged

The following areas should remain exactly on the current `main` implementation unless a separate future task proves a narrow reason to change them:

- `local auth handoff`
- `ADMIN MFA runtime`
- `ADMIN role command runtime`
- `domain lifecycle runtime`
- `wallet account status runtime`
- `withdrawal state machine runtime`
- `Phase 2 closeout`
- `Phase 3 closeout`
- `Phase 4 closeout`
- `runtime cleanup ownership`

### Discard As Integration Sources

The following WIP artifacts must not be restored as implementation sources:

- `scripts/phase/closeout-orchestrator.local.mjs`
- `scripts/lib/isolated-closeout-runner.mjs`
- Past self-owned runtime models.
- WIP Phase 2 closeout file replacements.
- WIP Phase 3 closeout file replacements.
- WIP Phase 4 closeout file replacements.
- Any WIP change that replaces current Phase 2 supervisor behavior.
- Any WIP change that replaces current P5-T02 reconciliation runtime closeout behavior.

### Optional Follow-Up Candidate

Only this file remains a selective follow-up candidate:

```text
scripts/ledger/deposit-state-machine.local.mjs
```

The candidate ideas are limited to:

- Stage-by-stage diagnostics shaped like `runDepositStage`.
- Safe stage start, pass, and fail markers.
- Non-duplicated failure markers.
- App port cleanup diagnostics.
- Safe failure cause classification.

The candidate explicitly excludes:

- Moving Supabase start/stop ownership from the current owner.
- Moving DB reset ownership from the current owner.
- Replacing the current supervisor.
- Restoring the isolated closeout runner.
- Changing `.env.local` creation or deletion ownership.
- Changing deposit behavior, responses, or fixture contracts as part of diagnostics.

## Optional Deposit Diagnostics Rules

If deposit staged diagnostics are pursued later, that work must be a separate task with its own branch and verification.

Required rules:

1. Start from current `main`.
2. Do not cherry-pick any WIP commit.
3. Reconstruct only the needed diagnostic ideas manually.
4. Keep existing deposit behavior, response shape, and fixture contracts unchanged.
5. Keep runtime ownership aligned with the current supervisor contract.
6. Do not print secrets, emails, JWTs, UUIDs, Supabase keys, DB URLs, private keys, or mnemonics.
7. Emit only safe stage markers and safe failure cause codes.

Expected verification for that future task:

```text
node --check
deposit local runtime
deposit repeat execution
Phase 3 closeout
Phase 4 closeout
Phase 2 supervisor regression
reconciliation review runtime
DB reset/lint/test/types
npm audit
lint
build
port/container cleanup
secret scan
```

## WIP Branch Archive Policy

The WIP branches are not deleted by this plan. They remain local preservation refs until archive or deletion is separately approved.

```text
wip/pre-p5-closeout-stability-preservation
wip/pre-p5-closeout-orchestration-integration-preservation
wip/pre-p5-closeout-orchestration-redesign-preservation
wip/pre-p5-clean-runtime-preservation
wip/pre-p5-sec04-runtime-preservation
wip/pre-p5-runtime-integration-preservation
```

Archive policy:

- Keep the WIP branches local for now.
- Do not push the WIP branches to a remote as part of this plan.
- Do not merge the WIP branches into current `main`.
- Do not delete WIP branches until this consolidation decision is accepted.
- Before deletion, record the exact commit SHA for every WIP branch.
- Treat this document as the reference for any later archive or deletion decision.

## Integration Strategy

Recommended strategy:

1. Keep current `main` as the implementation baseline.
2. Commit only this consolidation decision document when a commit is explicitly requested.
3. Do not stage, commit, push, merge, or cherry-pick WIP code as part of this document-only task.
4. If optional deposit diagnostics are approved later, create a separate feature branch and manually reimplement the narrow diagnostics.
5. After this WIP decision is accepted, return to the next product task: administrator reconciliation list and detail read APIs.

Rejected strategies:

- Whole-commit cherry-pick.
- Whole-branch merge.
- File restore from any WIP closeout script.
- Replacing current supervisor behavior.
- Replacing current local HTTP runtime behavior.
- Replacing current withdrawal runtime behavior.
- Reintroducing old orchestrator or isolated runner entry points.

## Final Counts

```text
Fully discardable:
3

Partial reference preservation:
3

WIP code to integrate into current main immediately:
0

Unfinished WIP work that must be completed now:
0

Optional improvement candidates:
1
```

The single optional improvement candidate is:

```text
Deposit staged diagnostics
```

## Final Recommendation

Keep current `main`.

Do not integrate any legacy WIP commit wholesale.

Use this document as the WIP consolidation and archive decision record.

If deposit diagnostics are still desired, implement them later as a narrow manual reconstruction on top of current `main`.

No source code, package metadata, migrations, tests, Supabase files, runtime scripts, branches, staging area, commits, or pushes are changed by this plan.

## Decision Status

```text
READY_FOR_WIP_ARCHIVE_DECISION
```
