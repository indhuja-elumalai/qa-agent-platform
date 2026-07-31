# Workflow A — URL plus existing test cases

## Purpose and setup

Validate that supplied manual cases are preserved, structured, approval-gated, executed only by Playwright, and reported with evidence. The approved KOG target was unavailable, so the safe local demo target `http://127.0.0.1:3100` was used.

| Field                                                   | Recorded result                                               |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Inputs                                                  | Demo URL, objective, two numbered manual cases; no repository |
| AI                                                      | Disabled; rule-based parser                                   |
| Cases supplied / generated / AI suggestions             | 2 / 0 / 0                                                     |
| Duplicates                                              | 0                                                             |
| Approved / executed                                     | 2 / 2                                                         |
| PASS / FAIL / BLOCKED / REVIEW                          | 2 / 0 / 0 / 0                                                 |
| Screenshots / traces / logs                             | 2 / 2 / 2, all available                                      |
| Manual estimate / automated duration / estimated saving | 4 min / 1.982 s / 4 min                                       |

## Observations

Both supplied cases remained in the candidate plan and required individual plus exact-version approval. Playwright ran only `TEST-001` and `TEST-002`; both deterministic visibility assertions passed. No optional gaps were created because AI was disabled. Coverage is limited to the supplied login-page checks and does not imply complete application coverage.

Security controls remained active: a loopback allowlist, no repository access, no credentials, no destructive actions, and evidence stored only under ignored `var/`. The time-saving figure is an estimate derived from entered per-case manual minutes, not a measured labour saving.

## Conclusion and artifacts

Workflow A passed on the demo fallback. It demonstrates preservation, approval, deterministic execution, evidence, and reporting.

- Request: `request_43ab1668-913a-41b5-93b8-849ea235e732`
- Plan: `plan_57dfd63c-da76-4074-ad9f-22871b786eed`, version 1
- Run: `run_4053fe87-3bb8-4c24-9296-5cbe4946aafc`
- Runtime report: `var/pilot-validation/reports/run_4053fe87-3bb8-4c24-9296-5cbe4946aafc/`
- Summary: `var/pilot-validation/summary.json`

Exact commands used (no secrets):

```bash
corepack pnpm --filter @qa/demo-target dev
corepack pnpm tsx scripts/run-pilot-workflows.ts
```
