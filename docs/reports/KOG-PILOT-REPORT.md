# KOG pilot readiness report — demo fallback executed

## Decision

No approved KOG staging URL, read-only repository mount, selectors, test credentials, or storage state was available. The platform therefore made no KOG connection and fabricated no KOG result. It executed five representative, non-destructive checks against `http://127.0.0.1:3100` instead.

## Access assumptions and configuration

The disabled validated template is `config/pilots/kog-agent2.disabled.json`. Before enablement it requires confirmation of the test/staging hostname, base-URL environment reference, repository-path environment reference and allowlisted root, authentication reference, permitted routes, prohibited actions, and retention period. The server rejects disabled, production, mismatched, out-of-root, out-of-route, and prohibited-action configurations.

Authentication for this fallback was `none`; no KOG credential was available or used. For a real pilot, supported server-side modes are approved Playwright storage state or environment-backed test credentials. Authenticated screenshots and traces are suppressed, and browser logs contain only a redaction marker.

## Demo execution

Five cases were individually and exactly approved: Login button visibility, Welcome heading visibility, Email visibility, Password visibility, and `/login` navigation.

| Result                                                  |                     Count |
| ------------------------------------------------------- | ------------------------: |
| Executed                                                |                         5 |
| PASS                                                    |                         4 |
| FAIL                                                    |                         1 |
| BLOCKED / REVIEW                                        |                     0 / 0 |
| Screenshots / traces / logs                             |                 5 / 5 / 5 |
| Manual estimate / automated duration / estimated saving | 10 min / 1.161 s / 10 min |

The Password visibility check found a genuine selector ambiguity: `getByText("Password")` matched both the label and demo credential hint. This demonstrates that selector quality affects deterministic execution; the corrective action is to edit the candidate to use the Password label before approval.

Artifacts:

- Run: `run_5967831a-f13d-4a48-bb72-df72ada4ebbe`
- Runtime report: `var/pilot-validation/reports/run_5967831a-f13d-4a48-bb72-df72ada4ebbe/`
- Summary: `var/pilot-validation/summary.json`

Exact commands used (no secrets):

```bash
corepack pnpm --filter @qa/demo-target dev
corepack pnpm tsx scripts/run-pilot-workflows.ts
```

## Readiness and recommendations

The platform is ready for a controlled KOG staging pilot after the named access dependencies are supplied and approximately five KOG-specific read-only cases are reviewed. It is not ready for production. Recommended next steps are: validate the disabled profile with approved values; confirm a least-privilege test user/storage state; agree route and action policies; perform one dry planning review; then execute only the approved cases during a defined retention window.
