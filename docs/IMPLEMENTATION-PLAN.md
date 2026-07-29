# QA Agent Platform — Implementation Plan

## Goal

Deliver a complete local, single-user vertical slice of a generic internal frontend QA platform. The slice must accept manual or repository-grounded QA requests, create an editable plan, enforce explicit approval, execute allowlisted Playwright actions, persist history, stream progress, retain evidence, and generate reports. It must remain useful without AI credentials and must not mutate inspected repositories.

## Scope and boundaries

- TypeScript monorepo with a Next.js web application and a separate demo target.
- Generic packages contain no KOG-specific behavior, selectors, paths, URLs, or credentials.
- Local repository scanning is metadata/text-only and restricted to configured roots.
- GitHub is a read-only, feature-flagged connector that fails safely without configuration.
- No arbitrary JavaScript, shell execution, repository writes, automatic application fixes, cloud resources, deployment, or production mutation.
- SQLite and the local filesystem are the POC persistence boundary.

## Implementation units

### U1. Workspace and contracts

Create pnpm workspace configuration, shared TypeScript/lint/test configuration, versioned Zod schemas, environment validation, logging, IDs, and common utilities.

Verification:

- Unsupported schema versions are rejected.
- Workspace type checking and schema unit tests pass.

### U2. Safety and repository analysis

Implement URL/host policy, production denial, redaction, safe filenames, local path restriction, bounded text scanning, framework/package-manager/script/route/component/test discovery, Git metadata and comparison facts, scan caching, and the disabled GitHub connector.

Verification:

- Traversal and disallowed paths are rejected.
- Target repositories are only opened read-only.
- Secret/binary/generated files are ignored.
- Unconfigured GitHub mode returns a structured blocker.

### U3. Planning and approvals

Implement natural-language parsing, structured-case handling, deterministic repository proposals, case/evidence mapping, separately reported gap suggestions, plan versioning, individual decisions, plan approval, and approval invalidation after edits.

Verification:

- User cases are retained.
- Duplicate relationships are visible.
- Unapproved or stale plans cannot execute.
- No-AI workflows create usable plans.

### U4. Persistence, jobs, execution, evidence, and reports

Implement SQLite migrations/repositories, durable in-process job interfaces, audit events, cancellation, allowlisted Playwright action execution, base-host enforcement, timeouts/retries, screenshot/trace/browser-log capture, deterministic result classification, history, reruns, and JSON/Markdown/HTML reporting.

Verification:

- Every approved case is accounted for.
- PASS/FAIL includes evidence or an explicit unavailable reason.
- Estimated time saved is calculated and labelled as an estimate.
- Failed-case and full-plan reruns retain plan/repository identity.

### U5. Web experience and APIs

Build the dashboard for new requests, chat planning, repository analysis, plan editing/approval, live run progress, results/history/comparison, evidence links, exports, cancellation, and reruns. Add strict internal API validation plus health/readiness endpoints.

Verification:

- Mutations acknowledge immediately and long work is processed as jobs.
- Progress updates without page reload.
- Editing an approved plan visibly requires reapproval.

### U6. Demo target and end-to-end proof

Create an isolated deterministic demo application with login, validation, protected routes, Agent-style navigation, a read-only page, and a safe form. Include example plans for the eight requested scenarios.

Verification:

- The demo and platform start independently.
- An approved plan runs against the demo and produces evidence/reports.
- A failing case can be rerun.

### U7. Packaging and documentation

Add Dockerfile, Compose, persistent-volume layout, non-root runtime, health checks, environment examples, and the requested product, architecture, POC, security, deployment, and KOG pilot documentation.

Verification:

- README commands match tested commands.
- Production build passes.
- Container build is attempted when the environment permits.

## Verification contract

Run, and fix implementation-caused failures in:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test:unit`
5. `pnpm test:integration`
6. `pnpm test:e2e`
7. `pnpm build`
8. `docker compose build` when Docker and dependency downloads are available

Browser checks cover desktop and mobile layouts for the primary dashboard flow.

## Definition of done

- All four input workflows produce a schema-valid candidate plan.
- Approval is enforced at case and plan level; edits invalidate approval.
- Only approved, executable, allowlisted actions run.
- Local scanning is bounded, cached, read-only, and evidence-backed.
- Progress, cancellation, evidence, deterministic outcomes, history, reruns, and reports work.
- No-AI mode is the default and fully functional.
- Documentation states exactly what was and was not verified.
- Generated databases, logs, credentials, screenshots, traces, reports, and browser artifacts remain untracked.
