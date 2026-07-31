# Workflow C — Repository plus existing test cases

## Purpose and setup

Validate preservation of supplied cases while repository-backed gaps remain separate. KOG access was unavailable; the demo repository `apps/demo-target` and loopback demo URL were substituted.

| Field                                                   | Recorded result                                               |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Inputs                                                  | Demo repository and URL, objective, two numbered manual cases |
| AI / planning                                           | Disabled; rule planner plus repository analyzer               |
| Cases supplied / generated gaps / AI suggestions        | 2 / 7 / 0                                                     |
| Duplicates                                              | 0                                                             |
| Approved / executed                                     | 2 / 2                                                         |
| PASS / FAIL / BLOCKED / REVIEW                          | 2 / 0 / 0 / 0                                                 |
| Screenshots / traces / logs                             | 2 / 2 / 2, all available                                      |
| Manual estimate / automated duration / estimated saving | 4 min / 0.535 s / 4 min                                       |

## Observations

Both supplied cases remained primary plan items with `USER` provenance. Seven repository-derived route gaps remained in the separate suggestions collection and were not auto-approved or executed. No title-level duplicates were found. The broad path-name mapper did not attach evidence directly to the two generic login assertions; provenance was nevertheless retained on every repository-derived suggestion.

The workflow increased coverage by combining supplied cases, repository evidence and gap suggestions. It does not provide requirement-to-test coverage or guarantee that all business cases are represented. The repository was read only, browser execution used the URL, and no target credentials or mutations were involved.

## Conclusion and artifacts

Workflow C passed. It preserved existing cases, separated additional gaps, enforced approval, and executed only approved cases.

- Request: `request_bdb10586-9b7b-4bb9-bd22-ca2f50a43b62`
- Plan: `plan_cef2cb49-5b71-4937-9ffb-2df4aa2b8332`, version 1
- Run: `run_d36811b6-3074-434f-acd9-12f74c435667`
- Runtime report: `var/pilot-validation/reports/run_d36811b6-3074-434f-acd9-12f74c435667/`
- Summary: `var/pilot-validation/summary.json`

Exact commands used (no secrets):

```bash
corepack pnpm --filter @qa/demo-target dev
corepack pnpm tsx scripts/run-pilot-workflows.ts
```
