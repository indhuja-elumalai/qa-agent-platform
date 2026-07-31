# Workflow B — Repository only

## Purpose and setup

Validate read-only repository analysis, repository-derived candidate generation, approval, and URL-based browser execution. KOG repository and staging access were unavailable, so the checked-out demo source `apps/demo-target` and `http://127.0.0.1:3100` were used.

| Field                                                   | Recorded result                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Inputs                                                  | Read-only local repository, demo URL, objective; no manual cases                  |
| Repository findings                                     | Next.js, React, 7 routes, 0 separately detected components, 0 frontend test files |
| AI / planning                                           | Disabled; repository analyzer and rule planner                                    |
| Cases supplied / generated / AI suggestions             | 0 / 7 / 0                                                                         |
| Duplicates                                              | 0                                                                                 |
| Approved / executed                                     | 2 / 2                                                                             |
| PASS / FAIL / BLOCKED / REVIEW                          | 0 / 0 / 0 / 2                                                                     |
| Screenshots / traces / logs                             | 2 / 2 / 2, all available                                                          |
| Manual estimate / automated duration / estimated saving | 4 min / 0.726 s / 4 min                                                           |

## Observations

The scan detected route files and attached their paths as repository evidence. All seven generated navigation cases carried a warning because they lacked deterministic page assertions; two were explicitly approved and correctly ended as `NEEDS_HUMAN_REVIEW`, not false passes. Playwright navigated the target URL and never executed repository code or package scripts.

`git status --porcelain=v1` was identical before and after the harness, confirming no additional repository mutation. The repository already contained implementation changes, so the analyzer accurately recorded `hasUncommittedChanges: true`. The workflow increased coverage candidates from repository evidence, but selector/assertion refinement is still required.

## Conclusion and artifacts

Workflow B passed its safety and lifecycle goals. The two outcomes require human review by design; this is not an execution failure.

- Request: `request_68cab1b5-c40c-4107-b328-c08227ac0f22`
- Plan: `plan_17c05223-3f4c-40ca-ab67-4967e6364539`, version 1
- Run: `run_7acb599f-9704-4e6b-9038-56467bd2e015`
- Runtime report: `var/pilot-validation/reports/run_7acb599f-9704-4e6b-9038-56467bd2e015/`
- Summary: `var/pilot-validation/summary.json`

Exact commands used (no secrets):

```bash
corepack pnpm --filter @qa/demo-target dev
corepack pnpm tsx scripts/run-pilot-workflows.ts
```
