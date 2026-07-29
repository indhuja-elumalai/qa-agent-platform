# POC demonstration

## Script

1. Start the platform and demo target.
2. Create a manual request targeting `http://localhost:3100`.
3. Paste the demo cases from `tests/fixtures/demo-plan.json`.
4. Review the structured items and warnings.
5. Approve selected read-only cases and approve the exact plan version.
6. Observe live queued/running/reporting progress.
7. Confirm PASS/FAIL/human-review accounting, screenshots, traces, browser logs, and reports.
8. Open history; rerun the plan or failures.
9. Configure an approved repository root, scan the demo target, and review routes/tests/risk evidence and separate suggestions.
10. Select GitHub mode without a token and confirm an actionable BLOCKED event.

## Expected outputs

- Persistent request, scan, plan version, approval, audit and run records
- Final deterministic status for every approved item
- `var/evidence/<run>/<test>/final.png`, trace and browser log
- `var/reports/<run>/report.json`, `.md`, `.html`
- Estimated manual duration, automated duration, and labelled estimated saving

## Success measurements

- 100% accounting for entered and approved cases
- No execution before exact-version approval
- No target repository byte changes
- No credentials or tokens in database/reports/logs
- UI acknowledges immediately and does not reload for progress
- Full no-AI path works

## Exclusions

Production use, unrestricted actions, external side effects, target source modification, automatic fixing, cloud deployment, multi-user authentication, full GitHub App integration, and claims of theoretical total coverage.
