# QA Agent Platform

An internal, evidence-first frontend QA automation platform. It turns manual instructions and read-only repository facts into versioned test plans, requires explicit human approval, executes only allowlisted Playwright actions, and retains deterministic results, evidence, audit history, reruns, and reports.

This local single-user proof of concept is deployment-packaged: its production
and container builds are verified. It is not production-ready.

## What works

- Manual cases and chat-style numbered instructions
- Read-only local repository inspection with bounded file/byte limits
- Read-only GitHub connector behind a feature flag
- Repository-grounded candidate cases and separate gap suggestions
- Per-case and exact-plan-version approval
- Approval invalidation after case edits
- Background scanning and execution with live polling, phases, and safe cancellation
- Allowlisted Playwright actions; no arbitrary JavaScript or shell commands
- Screenshots, traces, browser logs, JSON/Markdown/HTML reports (browser artifacts are suppressed for cases that enter redacted values)
- Persistent run history, full reruns, and failed-case reruns
- Estimated manual time and estimated time saved
- Fully functional rule-based planning without AI credentials
- Isolated deterministic demo target

## Walkthrough

1. Open the platform and choose **New QA run**.
2. Keep the default demo URL, enter an objective, and paste:

   ```text
   1. The Login button is visible.
   2. Invalid credentials show "Invalid credentials".
   ```

3. Create the candidate plan. Review warnings, evidence, and side-effect levels; edit a case inline if its title, route, or expected result needs correction.
4. Approve each executable case, then approve the exact plan version.
5. Watch the queued/running/reporting phases and case results update without a page reload.
6. Open **Results & history** or rerun the full plan / failed cases.

## Architecture

```text
Next.js UI/API
     │
     ▼
Orchestrator ── durable in-process job interface
  │   │   │
  │   │   ├── rule-based / optional AI planning adapters
  │   ├────── repository connectors + deterministic analysis
  ├────────── Playwright allowlist runner
  └────────── SQLite repository + filesystem evidence/reports
```

Package boundaries are under `packages/`; the demo application has no dependency on the generic core. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

- Node.js 22.5 or newer (active LTS recommended)
- Corepack
- A Playwright-compatible Chromium installation
- Docker and Docker Compose only for container use

## Install and start

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
cp .env.example .env.local
corepack pnpm db:init
```

The commands invoke pnpm through Corepack directly, so creating global package
manager shims is not required. `corepack enable` is optional and may require
administrator access when Node.js is installed under a system-owned directory.

Terminal 1:

```bash
QA_ALLOWED_TARGET_HOSTS=localhost,127.0.0.1 corepack pnpm dev:web
```

Terminal 2:

```bash
corepack pnpm dev:demo
```

Open `http://localhost:3000`. The demo target is `http://localhost:3100`.
`NEXT_PUBLIC_DEFAULT_TARGET_URL` controls the URL prefilled in the web UI.

## Test and build

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm test:e2e
corepack pnpm build
docker compose config --quiet
docker compose build
```

## Local repository scanning

Set an explicit comma-separated root allowlist, restart the server, and enter a repository path beneath one of those roots:

```bash
QA_ALLOWED_REPOSITORY_ROOTS=/Users/example/work,/srv/read-only-repositories
```

The connector canonicalises paths, resolves symlinks, ignores Git/dependency/build/secret/binary paths, enforces limits, reads source text and metadata only, and invokes only fixed read-only `git` commands. It never runs package scripts. For strongest containment in containers, mount target repositories read-only.

## GitHub read-only mode

```bash
GITHUB_CONNECTOR_ENABLED=true
GITHUB_TOKEN=github_read_only_token
```

The token is read only from the environment and is not logged or persisted. Without both values GitHub scans emit a structured `BLOCKED` event. OAuth, GitHub Apps, webhooks, comments, branches, pushes, and repository modification are out of scope.

## AI configuration

AI planning is off by default. Rule-based planning remains the no-credential default. Enable the OpenAI adapter with an explicit model and server-side API key; structured proposals are Zod-validated, remain unapproved, and fall back clearly to rule-based planning if configuration or the provider fails.

```bash
AI_TEST_PLANNING_ENABLED=true
AI_PROVIDER=openai
AI_MODEL=your-approved-model
OPENAI_API_KEY=
```

Repository content is untrusted data, never operational instruction. AI proposals could never approve themselves or determine Playwright assertion outcomes.

## Evidence and reports

- Database: `var/qa-platform.db`
- Evidence: `var/evidence/<run-id>/<test-id>/`
- Reports: `var/reports/<run-id>/report.{json,md,html}`

The database stores safe metadata and paths, not screenshots or traces. `var/` is ignored except for directory placeholders.

## Docker

```bash
docker compose build
docker compose up
```

The web UI is exposed on loopback port 3000 and demo target on loopback port 3100. `qa-data` persists history and evidence. Set `QA_REPOSITORY_MOUNT` to a
host repository directory that local-source scans may read; Compose mounts it
read-only at `/repositories`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Current limitations

- Single process and single user; no authentication/RBAC on the platform itself
- In-process jobs recover persisted records after restart but do not resume interrupted browsers
- SQLite uses Node's built-in `node:sqlite` API; Node 22 still labels it experimental
- UI plan editing covers the title, route, and expected result; rich inline step editing is not included
- Chat context lives in the current browser draft; it is not a multi-user conversation store
- GitHub connector fetches a bounded selected file set and supports the first 100 PR files
- AI provider tests are mocked; live API calls require explicit configuration and were not run
- Comparison UI is limited to opening historical runs side by side manually
- Browser credentials supplied through environment adapters are interface-ready but the demo uses only no-auth and storage state

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [POC demonstration](docs/POC.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [KOG pilot readiness](docs/KOG-PILOT.md)
- [Internal APIs](docs/API.md)
