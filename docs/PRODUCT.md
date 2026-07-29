# Product definition

## Objective and personas

The platform helps frontend engineers, QA engineers, product owners, and pilot reviewers turn accepted QA intent into repeatable, evidence-backed browser checks. It measures entered/approved-case accounting and estimated time saved; it never claims all theoretical edge cases are covered.

## Supported journeys

1. **Manual/chat** — enter objective and cases, validate a candidate plan, approve cases and plan, execute.
2. **Repository proposal** — scan an approved local/GitHub source, review analysis and evidence-backed candidates, approve, execute.
3. **Repository plus existing cases** — retain user cases, map evidence, show exact duplicates and separate gap suggestions.
4. **No cases** — derive candidates from repository evidence/objective, expose uncertainty, require approval.

## Acceptance criteria

- Invalid input returns field-level validation and unsupported schema versions are rejected.
- Every user case remains visible; duplicates identify their relationship.
- Repository proposals include rationale and evidence or a visible unsupported warning.
- Chat text never executes directly.
- Each case and the exact plan version require approval; edits invalidate approval.
- Prohibited side effects cannot execute. Staging test data requires extra approval.
- Runs expose queued, running/reporting/completed/cancelled/failed progress.
- Every approved case is PASS, FAIL, WARNING, BLOCKED, NEEDS_HUMAN_REVIEW, or NOT_EXECUTED.
- Deterministic PASS/FAIL includes evidence or an explicit unavailability reason.
- History, reruns, evidence, and reports preserve plan/repository identity.

## Measurements

**Approved-case coverage** counts total, valid, invalid, approved, executed, passed, failed, blocked, warning, human-review, and not-executed cases. It is accounting for the plan, not a completeness claim about the application.

**Testing time saved** subtracts recorded automated duration from user-supplied manual estimates, floors the result at zero, and is always labelled an estimate.

**Repeatability** means the exact approved plan version can be rerun completely or by failures while evidence remains attached to each run.
