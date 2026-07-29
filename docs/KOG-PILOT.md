# KOG pilot readiness

The generic core contains no KOG paths, URLs, selectors, credentials, or business behavior. The disabled placeholder is `config/examples/kog-agent2.disabled.yaml`.

## Required decisions and access

- Approved read-only local path for the KOG dashboard repository
- Approved read-only local path for Agent 2 if separate
- Staging base URL and host allowlist entry
- Playwright storage-state file or environment-supplied test credential adapter
- Existing cases and their manual time estimates
- Explicit list of staging test-data actions that may be approved
- Prohibited routes/actions and data-retention period
- Repository comparison ref or pilot PR

## Procedure

1. Mount or expose repositories read-only beneath an allowed root.
2. Supply paths through `KOG_AGENT2_REPOSITORY_PATH`; never commit actual paths.
3. Supply staging URL through `KOG_AGENT2_BASE_URL`.
4. Create storage state outside the repository and supply `KOG_STORAGE_STATE_PATH`.
5. Import existing cases; verify all remain present.
6. Review evidence mappings and gap suggestions separately.
7. Edit semantic selector intents where repository evidence cannot confirm UI names.
8. Approve only allowed read-only/staging-data cases, then approve the exact plan.

## Prohibited actions

Production mutation, external side effects, sending real customer data, unrestricted scripts, repository writes, selector/business-data commits, automatic fixes, and plan self-approval.

## Pilot success metrics

- Entered/approved-case accounting reaches 100%
- Useful evidence for every deterministic result
- Repeatable reruns against the same commit/ref
- Estimated manual time captured and estimate clearly labelled
- No target repository or credential modification/exposure
- Pilot reviewers accept proposed cases and blocker messages as actionable
