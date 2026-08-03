# QA Agent Platform — consolidated report

## 1. Executive summary

The team now has a reusable QA platform that turns objectives, existing cases, and optional read-only repository evidence into a candidate test plan. A person approves each case and the exact plan version before Playwright executes it. The platform records deterministic results, evidence, estimates, audit events, and rerun history.

The local demonstration and all four workflow shapes are validated. KOG was not contacted because its approved staging URL, repository mount, and authentication were not supplied; five analogous checks ran on the demo instead. Live OpenAI validation is also blocked because the approved local secret mechanism currently contains neither a usable API key nor a confirmed model. AI remains optional and the rule-based path works.

Recommendation: ready for local demonstrations; conditionally ready for a small controlled KOG staging pilot after access configuration; not ready for production or an expanded pilot.

## 2. Problem and objectives

The platform preserves existing test knowledge while adding structured, reviewable gaps from objectives and repository facts. It aims to reduce repetitive manual checks, estimate time saved, and improve trust through explicit approvals and evidence. It does not promise total coverage: that requires a defined requirements-to-tests mapping that is not yet implemented.

## 3. How the agent works

```text
User → UI → validated API → Orchestrator → optional repository analyzer
     → rule planner / optional OpenAI planner → candidate plan
     → human case + exact-version approval → Playwright
     → evidence and reports → SQLite history
```

Planning suggests what to test. Approval controls what may run. Playwright alone performs browser actions and determines PASS, FAIL, BLOCKED, or REVIEW. Reporting explains outcomes and estimates. AI assists planning only, cannot approve cases, and cannot assign execution results.

## 4. Architecture and technology

| Component     | Technology and purpose                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Web/API       | Next.js and React provide the local workflow UI and validated server API                       |
| Orchestration | TypeScript/Node.js coordinate scanning, planning, approvals, queues, runs, reruns, and reports |
| Validation    | Zod enforces request, plan, action, AI-output, and pilot-profile schemas                       |
| Execution     | Playwright provides browser isolation, deterministic assertions, traces, screenshots, and logs |
| Persistence   | SQLite stores local structured history and safe metadata                                       |
| Planning      | Rule templates work offline; the OpenAI Node SDK optionally parses strict structured output    |
| Engineering   | pnpm, Vitest, ESLint, TypeScript, Docker and Compose support repeatable builds and tests       |

The repository analyzer reads allowlisted text and fixed Git metadata only; it never installs dependencies or executes repository scripts.

## 5. Supported workflows and operation

| Workflow              | Primary input                | Demonstrated outcome                      |
| --------------------- | ---------------------------- | ----------------------------------------- |
| A: URL + cases        | URL and supplied cases       | 2 supplied, 2 PASS                        |
| B: repository only    | URL and read-only repository | 7 proposed; 2 approved, both REVIEW       |
| C: repository + cases | All three                    | 2 supplied PASS; 7 gaps separate          |
| D: objective + URL    | Objective, no cases          | Rule-generated case PASS; live AI blocked |

To run: start the platform and target; enter application, approved URL, non-production environment, objective, repository mode, and cases; generate the candidate plan; inspect evidence and warnings; approve cases and exact version; run; inspect results/evidence/reports; rerun all or failed cases as needed. Use the local demo URL for development and an explicitly approved staging URL for pilots. Production is denied by default.

## 6. Validation results

| Validation                               | Result                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| Four workflow runs                       | 5 PASS, 0 FAIL, 2 REVIEW across 7 executed cases            |
| KOG demo fallback                        | 4 PASS, 1 selector-ambiguity FAIL                           |
| Total evidence from these runs           | 12 screenshots, 12 traces, 12 browser logs                  |
| Estimated manual time / estimated saving | 24 minutes / 24 minutes                                     |
| Measured automated browser duration      | 4.647 seconds                                               |
| Repository safety                        | Git status identical before and after the workflow harness  |
| Live OpenAI                              | Blocked before provider call: no key and no confirmed model |

The failure was useful: the word “Password” matched two elements, showing why candidates need review and precise selectors. Repository-only navigation proposals correctly produced REVIEW rather than false PASS.

Detailed evidence is in the four workflow reports and KOG readiness report under `docs/reports/`. Runtime artifacts are ignored under `var/pilot-validation/`.

## 7. Advantages

- Reusable across frontend applications and usable without AI, a repository, or existing cases.
- Deterministic Playwright authority with human approvals and exact versioning.
- Read-only repository evidence, separate gap suggestions, audit history, and safe reruns.
- Provider-neutral planning boundary, bounded/redacted AI input, and graceful fallback.
- Evidence and time estimates support review and staged adoption.

## 8. Disadvantages and limitations

- Local single-instance SQLite and an in-process queue; no distributed workers.
- No enterprise SSO/RBAC, managed secrets, object storage, or audit export.
- Authentication must be configured and reviewed per target.
- Repository heuristics cannot guarantee business or requirements coverage.
- Selector quality affects execution; AI suggestions may need correction.
- Pilot artifact-retention days are validated metadata; automated expiry cleanup is not implemented.
- Live AI adds cost/latency and has not been account-validated in this environment.
- KOG setup remains dependent on approved staging access.

## 9. Security model

Targets and repository/configuration roots are allowlisted; production-like hosts are denied. Repository access is read-only. Browser actions are schema-restricted and same-origin. Each case and exact plan version requires human approval; prohibited external/production side effects are rejected. Secrets are environment-resolved server-side, redacted from provider input and persistence, and never exposed in the UI. Sensitive authenticated screenshots and traces are suppressed, logs contain a redaction marker, and no production or destructive test was run.

## 10. KOG and AI readiness

The KOG profile is now a validated, disabled JSON template with environment references instead of secrets. A controlled pilot needs the approved staging URL/host, read-only repository mount/root, reviewed routes/actions, retention, and test authentication. The sample fallback demonstrates the lifecycle but is not KOG evidence.

The OpenAI adapter already uses strict Zod structured output, bounded untrusted input, unapproved suggestions, and visible fallback. `AI_MODEL` remains configurable. With an approved key, the safe validation is one account model-list check followed by one synthetic structured-output request using the configured model, or an accessible documented low-cost compatible model. No model is currently selected.

## 11. Prioritised enhancements

Near term: run the controlled KOG staging pilot; improve the step/selector editor; add requirement-to-test traceability and a measurable coverage dashboard; manage reusable authentication profiles; compare reports over time.

Production phase: SSO/RBAC; durable queue/workers; managed database/object storage/secret manager; stronger browser isolation and network policy; observability and audit export; backups/disaster recovery; load testing; formal security review.

## 12. Recommendation

| Stage                        | Recommendation                                                         |
| ---------------------------- | ---------------------------------------------------------------------- |
| Local demonstration          | Ready                                                                  |
| Controlled KOG staging pilot | Ready after named access/configuration dependencies                    |
| Expanded pilot               | Not yet; first resolve initial pilot findings and operational controls |
| Production                   | Not ready                                                              |

## 13. Leadership speaking script

“We built a controlled QA assistant that helps plan tests without taking authority away from people or the test runner. Teams can bring a URL, existing cases, repository evidence, or simply an objective. The platform structures a candidate plan, but nothing runs until a person approves each case and the exact version. Playwright—not AI—executes the browser steps and determines the result, with screenshots, traces, logs, history, and time estimates. All four workflow types work locally. We deliberately did not contact KOG or OpenAI because the approved runtime access was not present; safe fallbacks proved the lifecycle instead. The next step is a small read-only KOG staging pilot with approved authentication. Production hardening remains a separate phase.”

## 14. FAQ

**Is AI mandatory?** No; rule-based planning works independently.

**Does AI execute tests or decide PASS/FAIL?** No; Playwright does both execution and assertions.

**Can it work without a repository or existing cases?** Yes to both.

**Can it test any URL?** No; only explicitly allowlisted HTTP(S) targets.

**Which URL should be used?** Local demo for development; approved non-production staging for pilots.

**Can it test production?** Not under the current safety model.

**Can it modify repositories?** No; local analysis is read-only and does not run repository code.

**How is time saved calculated?** Approved case manual-minute estimates minus measured automated duration, presented as an estimate.

**Does it guarantee all cases are covered?** No.

**What is needed before production?** Enterprise identity/authorization, managed infrastructure and secrets, isolation/network controls, observability, resilience testing, and formal security approval.
