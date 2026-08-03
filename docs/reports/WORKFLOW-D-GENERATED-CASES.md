# Workflow D — Objective and URL, no existing cases

## Purpose and setup

Validate independent rule-based generation and, when credentials permit, one controlled OpenAI structured-output check. KOG was unavailable, so the demo URL was used without a repository.

| Field                                                   | Recorded result                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Inputs                                                  | Demo URL and objective; no existing cases or repository                                                     |
| Rule-based run                                          | Completed                                                                                                   |
| Live OpenAI run                                         | Blocked before any provider call                                                                            |
| Selected AI model                                       | None; neither an approved configured model nor an accessible account model could be confirmed without a key |
| Cases supplied / generated / AI suggestions             | 0 / 1 / 0                                                                                                   |
| Duplicates                                              | 0                                                                                                           |
| Approved / executed                                     | 1 / 1                                                                                                       |
| PASS / FAIL / BLOCKED / REVIEW                          | 1 / 0 / 0 / 0                                                                                               |
| Screenshots / traces / logs                             | 1 / 1 / 1, all available                                                                                    |
| Manual estimate / automated duration / estimated saving | 2 min / 0.243 s / 2 min                                                                                     |

## OpenAI validation decision

The ignored `.env.local` and process environment were checked without printing values. `OPENAI_API_KEY` and `AI_MODEL` were absent, so model listing and the live structured-output request were not attempted. No model was guessed or written into source. The existing adapter remains configurable through `AI_MODEL`.

Official OpenAI model documentation identifies low-cost Chat Completions models with structured-output support, including `gpt-4o-mini`; that is only a candidate for the future account-access check, not a selected model. The safe future sequence is: prefer a configured organisational model; otherwise list account-accessible models, intersect with documented structured-output-compatible low-cost models, then make one synthetic parse request. See [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-4o-mini).

## Conclusion and artifacts

The rule-based half passed and proves the platform works independently of AI. Live AI validation is accurately blocked on the approved runtime key/model-access dependency. Unit coverage already simulates provider failure and verifies visible rule-based fallback.

- Request: `request_f2c065a2-55d5-40f4-bf36-256b10e34ef7`
- Plan: `plan_bc3c7ecf-95bb-42e7-9a94-8e69cbd48c1d`, version 1
- Run: `run_ca2ea220-c324-4c76-a573-017d02e06568`
- Runtime report: `var/pilot-validation/reports/run_ca2ea220-c324-4c76-a573-017d02e06568/`

Exact commands used (no secrets):

```bash
corepack pnpm --filter @qa/demo-target dev
corepack pnpm tsx scripts/run-pilot-workflows.ts
```
